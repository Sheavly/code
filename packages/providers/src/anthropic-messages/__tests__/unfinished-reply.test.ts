import { describe, expect, it } from 'vitest';
import { collect, fakeFetchSequence } from '@sheavly/testing/fetch/fake-fetch.fake';
import { providerRequest } from '../../testing/provider-request.fake.js';
import { TEST_REQUEST } from '../../testing/request.constants.js';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { toMessagesApiMessages } from '../input.utils.js';
import { createMessagesProvider } from '../messages.helper.js';

function reply(events: object[]) {
  const { fetch } = fakeFetchSequence({ responses: [events], complete: false });

  return createMessagesProvider({
    endpoint: { baseUrl: 'https://example.test/v1', model: 'claude', headers: {} },
    maxTokens: 4096,
    thinkingMode: 'adaptive',
    request: TEST_REQUEST,
    fetch,
  }).stream(providerRequest());
}

const usage = {
  type: 'message_start',
  message: { usage: { input_tokens: 100, output_tokens: 1 } },
};
const stop = { type: 'message_stop' };
const capped = {
  type: 'message_delta',
  delta: { stop_reason: 'max_tokens' },
  usage: { output_tokens: 4096 },
};
const text = [
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'Design starts here.' },
  },
];

describe('unfinished Messages replies', () => {
  it('retains streamed text and final usage when an explicit output cap leaves text open', async () => {
    const events = await collect(reply([usage, ...text, capped, stop]));

    expect(events).toEqual([
      { type: 'text_delta', text: 'Design starts here.' },
      {
        type: 'done',
        stopReason: 'max_tokens',
        usage: {
          tokens: { inputTokens: 100, outputTokens: 4096, cacheReadTokens: 0, cacheWriteTokens: 0 },
        },
      },
    ]);
  });

  it('never releases a tool call whose block remained open, even with parseable arguments', async () => {
    const events = await collect(
      reply([
        ...text,
        { type: 'content_block_stop', index: 0 },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'write-1', name: 'write_file' },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"path":"design.md"}' },
        },
        capped,
        stop,
      ]),
    );

    expect(events.map((event) => event.type)).toEqual(['text_delta', 'done']);
    expect(events.at(-1)).toMatchObject({ stopReason: 'max_tokens' });
  });

  it('releases a tool call that completed before the cap, keeps no replay state, and rebuilds it plainly', async () => {
    const events = await collect(
      reply([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'write-1', name: 'write_file' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"path":"a.md"}' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: 'Next' } },
        capped,
        stop,
      ]),
    );

    // No `reasoning` item: partial replay would drop the open text, so history is the record.
    expect(events.map((event) => event.type)).toEqual(['tool_call', 'text_delta', 'done']);

    const sent = toMessagesApiMessages({
      messages: [
        { role: 'user', content: 'go' },
        {
          role: 'assistant',
          content: 'Next',
          toolCalls: [
            { id: callIdSchema.parse('write-1'), name: 'write_file', input: { path: 'a.md' } },
          ],
        },
        { role: 'tool', toolCallId: callIdSchema.parse('write-1'), content: 'ok', isError: false },
      ],
      reasoningSource: 'anthropic:claude',
      instructions: undefined,
      tools: [],
    });

    expect(sent[1]?.content.map((block) => block.type)).toEqual(['text', 'tool_use']);
  });

  it('drops unsigned unfinished thinking without poisoning the continuation history', async () => {
    const events = await collect(
      reply([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: 'Partial' },
        },
        capped,
        stop,
      ]),
    );

    expect(events).toEqual([
      { type: 'reasoning_activity', active: true },
      { type: 'reasoning_activity', active: false },
      { type: 'done', stopReason: 'max_tokens' },
    ]);
  });

  it.each(['end_turn', 'tool_use', 'model_context_window_exceeded', undefined])(
    'still rejects an unfinished block with stop reason %s, without exposing its content',
    async (reason) => {
      const ending = reason ? [{ type: 'message_delta', delta: { stop_reason: reason } }] : [];

      await expect(collect(reply([...text, ...ending, stop]))).rejects.toMatchObject({
        reason: 'cut_off',
        message: `Messages reply ended with unfinished content blocks (stop reason: ${reason ?? 'unknown'}; blocks: 0:text)`,
      });
    },
  );

  it('does not treat a missing message_stop as output-limit completion', async () => {
    await expect(collect(reply([...text, capped]))).rejects.toMatchObject({ reason: 'cut_off' });
  });
});
