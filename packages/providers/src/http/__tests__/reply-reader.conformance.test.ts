import { describe, expect, it } from 'vitest';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import { readResponsesReply } from '../../responses/responses-stream.helper.js';
import { readChatReply } from '../../chat-completions/chat-stream.helper.js';
import { readMessagesReply } from '../../anthropic-messages/messages-stream.helper.js';

/** One protocol's fixtures for each scenario, as the events its API streams. */
type Fixtures = {
  complete: object[];
  unknownEvent: object;
  errorEvent: object;
  cutOff: object[];
  capped: object[];
};

const body = (events: object[]) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''))
    .body as ReadableStream<Uint8Array>;

const chat = (delta: object, finish: string | null = null) => ({
  choices: [{ index: 0, delta, finish_reason: finish }],
});

const messagesText = (text: string) => [
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
];

const PROTOCOLS: Record<
  string,
  {
    fixtures: Fixtures;
    read: (params: { events: object[]; signal: AbortSignal }) => AsyncIterable<StreamEvent>;
  }
> = {
  responses: {
    read: ({ events, signal }) =>
      readResponsesReply({ body: body(events), reasoningSource: undefined, signal }),
    fixtures: {
      complete: [
        { type: 'response.output_text.delta', delta: 'hi' },
        { type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 2 } } },
      ],
      unknownEvent: { type: 'response.in_progress' },
      errorEvent: { type: 'error', error: { message: 'boom' } },
      cutOff: [{ type: 'response.output_text.delta', delta: 'hi' }],
      capped: [
        { type: 'response.output_text.delta', delta: 'hi' },
        {
          type: 'response.incomplete',
          response: { incomplete_details: { reason: 'max_output_tokens' } },
        },
      ],
    },
  },
  chat: {
    read: ({ events, signal }) =>
      readChatReply({ body: body(events), source: 'chat:test', replayReasoning: false, signal }),
    fixtures: {
      complete: [
        chat({ content: 'hi' }, 'stop'),
        { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } },
      ],
      unknownEvent: { object: 'chat.completion.chunk.extra' },
      errorEvent: { error: { message: 'boom' } },
      cutOff: [chat({ content: 'hi' })],
      capped: [chat({ content: 'hi' }, 'length')],
    },
  },
  messages: {
    read: ({ events, signal }) =>
      readMessagesReply({ body: body(events), reasoningSource: undefined, prefix: '', signal }),
    fixtures: {
      complete: [
        { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } },
        ...messagesText('hi'),
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
        { type: 'message_stop' },
      ],
      unknownEvent: { type: 'ping' },
      errorEvent: { type: 'error', error: { type: 'overloaded_error', message: 'boom' } },
      cutOff: [
        { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } },
        ...messagesText('hi'),
      ],
      capped: [
        { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } },
        ...messagesText('hi'),
        { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
        { type: 'message_stop' },
      ],
    },
  },
};

const live = () => new AbortController().signal;

describe.each(Object.entries(PROTOCOLS))('%s reader conformance', (_name, { fixtures, read }) => {
  it('streams text and ends with one done carrying the final usage', async () => {
    const events = await collect(read({ events: fixtures.complete, signal: live() }));

    expect(events).toContainEqual({ type: 'text_delta', text: 'hi' });
    expect(events.at(-1)).toEqual({
      type: 'done',
      stopReason: 'end_turn',
      usage: {
        tokens: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    });
    expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
  });

  it('skips an event it does not use, anywhere in the stream', async () => {
    const [first = {}, ...rest] = fixtures.complete;
    const events = await collect(
      read({ events: [first, fixtures.unknownEvent, ...rest], signal: live() }),
    );

    expect(events).toEqual(await collect(read({ events: fixtures.complete, signal: live() })));
  });

  it('fails a stream error event with its reason and the provider text', async () => {
    const failure: unknown = await collect(
      read({ events: [fixtures.errorEvent], signal: live() }),
    ).catch((caughtError: unknown) => caughtError);

    expect(failure).toMatchObject({ reason: 'stream_error' });
    expect((failure as Error).message).toContain('boom');
  });

  it('fails a stream that ends before its end marker as cut_off', async () => {
    await expect(collect(read({ events: fixtures.cutOff, signal: live() }))).rejects.toMatchObject({
      reason: 'cut_off',
    });
  });

  it('lets the caller interrupt a cut-off stream go up as the abort, not as cut_off', async () => {
    const controller = new AbortController();

    controller.abort();

    await expect(
      collect(read({ events: fixtures.cutOff, signal: controller.signal })),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('keeps a reply that ended even if the signal aborted afterwards', async () => {
    const controller = new AbortController();

    controller.abort();

    const events = await collect(read({ events: fixtures.complete, signal: controller.signal }));

    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'end_turn' });
  });

  it('ends a reply cut off by the output limit as max_tokens, keeping the streamed text', async () => {
    const events = await collect(read({ events: fixtures.capped, signal: live() }));

    expect(events).toContainEqual({ type: 'text_delta', text: 'hi' });
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'max_tokens' });
  });
});
