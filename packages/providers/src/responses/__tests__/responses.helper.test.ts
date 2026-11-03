import { describe, expect, it } from 'vitest';
import { collect, fakeFetch, fakeFetchSequence } from '@sheavly/testing/fetch/fake-fetch.fake';
import { providerRequest } from '../../testing/provider-request.fake.js';
import { TEST_REQUEST } from '../../testing/request.constants.js';
import { createResponsesProvider } from '../responses.helper.js';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

const c1 = callIdSchema.parse('c1');
const request = providerRequest;

const provider = (fetch: typeof globalThis.fetch) =>
  createResponsesProvider({
    endpoint: { baseUrl: 'https://example.test/v1', model: 'm', headers: { 'x-key': 'k' } },
    request: TEST_REQUEST,
    fetch,
  });

describe('createResponsesProvider', () => {
  it('streams text deltas and ends the turn', async () => {
    const { fetch } = fakeFetch([
      { type: 'response.output_text.delta', delta: 'Hel' },
      { type: 'response.output_text.delta', delta: 'lo' },
      { type: 'response.completed', response: {} },
    ]);

    expect(await collect(provider(fetch).stream(request()))).toEqual([
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });

  it('emits tool calls with parsed arguments', async () => {
    const { fetch } = fakeFetch([
      {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'c1',
          name: 'get_weather',
          arguments: '{"city":"Oslo"}',
        },
      },
    ]);

    expect(await collect(provider(fetch).stream(request()))).toEqual([
      { type: 'tool_call', call: { id: 'c1', name: 'get_weather', input: { city: 'Oslo' } } },
      { type: 'done', stopReason: 'tool_use' },
    ]);
  });

  it('ignores non-function output items', async () => {
    const { fetch } = fakeFetch([{ type: 'response.output_item.done', item: { type: 'message' } }]);

    expect(await collect(provider(fetch).stream(request()))).toEqual([
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });

  it('reports max_tokens when the response is incomplete', async () => {
    const { fetch } = fakeFetch([
      {
        type: 'response.incomplete',
        response: { incomplete_details: { reason: 'max_output_tokens' } },
      },
    ]);
    const events = await collect(provider(fetch).stream(request()));

    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'max_tokens' });
  });

  it('translates history and tools into the request body', async () => {
    const { fetch, requests } = fakeFetch([]);

    await collect(
      provider(fetch).stream(
        request({
          messages: [
            { role: 'user', content: 'weather?' },
            {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: c1, name: 'get_weather', input: { city: 'Oslo' } }],
            },
            { role: 'tool', toolCallId: c1, content: 'Sunny', isError: false },
          ],
          tools: [{ name: 'get_weather', description: 'd', inputSchema: { type: 'object' } }],
        }),
      ),
    );

    expect(requests[0]?.url).toBe('https://example.test/v1/responses');
    expect(requests[0]?.headers['x-key']).toBe('k');
    expect(requests[0]?.body).toMatchObject({
      model: 'm',
      stream: true,
      input: [
        { role: 'user', content: 'weather?' },
        { type: 'function_call', call_id: 'c1', name: 'get_weather', arguments: '{"city":"Oslo"}' },
        { type: 'function_call_output', call_id: 'c1', output: 'Sunny' },
      ],
      tools: [
        { type: 'function', name: 'get_weather', description: 'd', parameters: { type: 'object' } },
      ],
    });
  });

  it('sends system instructions as the `instructions` field, and none when absent', async () => {
    const { fetch, requests } = fakeFetch([]);

    await collect(provider(fetch).stream(request({ instructions: 'Use npm.' })));
    await collect(provider(fetch).stream(request()));

    expect(requests[0]?.body).toMatchObject({ instructions: 'Use npm.' });
    expect(requests[0]?.body.input).toEqual([{ role: 'user', content: 'hi' }]);
    expect(requests[1]?.body).not.toHaveProperty('instructions');
  });

  it('throws on HTTP errors', async () => {
    const { fetch } = fakeFetch([], 401);

    await expect(collect(provider(fetch).stream(request()))).rejects.toThrow(
      'Responses API error 401',
    );
  });

  it('throws when the response fails mid-stream', async () => {
    const { fetch } = fakeFetch([
      { type: 'response.failed', response: { error: { message: 'overloaded' } } },
    ]);

    await expect(collect(provider(fetch).stream(request()))).rejects.toThrow('overloaded');
  });

  it('throws on mid-stream error events (HTTP 200)', async () => {
    const { fetch } = fakeFetch([
      { type: 'response.output_text.delta', delta: 'partial' },
      {
        type: 'error',
        error: { type: 'too_many_requests', code: 'no_capacity', message: 'high demand' },
      },
    ]);

    await expect(collect(provider(fetch).stream(request()))).rejects.toThrow(
      'stream error: high demand',
    );
  });
});

describe('createResponsesProvider: the end of a stream', () => {
  const cutOff = (events: object[]) =>
    fakeFetchSequence({ responses: [events], complete: false }).fetch;

  it('throws when the stream ends after text deltas without a terminal event', async () => {
    const fetch = cutOff([{ type: 'response.output_text.delta', delta: 'partial' }]);

    await expect(collect(provider(fetch).stream(request()))).rejects.toThrow(
      'Responses stream ended before response.completed',
    );
  });

  it('reports a body cut off mid-payload as a stream that ended early', async () => {
    const fetch = (async () =>
      new Response(
        'data: {"type":"response.output_text.delta","delta":"a"}\n\ndata: {"ty',
      )) as typeof globalThis.fetch;

    await expect(collect(provider(fetch).stream(request()))).rejects.toThrow(
      'Responses stream ended before response.completed',
    );
  });

  it('throws when the stream ends after a tool call without a terminal event', async () => {
    const fetch = cutOff([
      {
        type: 'response.output_item.done',
        item: { type: 'function_call', call_id: 'c1', name: 'f', arguments: '{}' },
      },
    ]);
    const events: unknown[] = [];

    await expect(async () => {
      for await (const event of provider(fetch).stream(request())) events.push(event);
    }).rejects.toThrow('ended before response.completed');
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'done' }));
  });

  it('ends the turn on response.incomplete for another reason, without throwing', async () => {
    const fetch = cutOff([
      { type: 'response.output_text.delta', delta: 'x' },
      {
        type: 'response.incomplete',
        response: { incomplete_details: { reason: 'content_filter' } },
      },
    ]);

    expect((await collect(provider(fetch).stream(request()))).at(-1)).toEqual({
      type: 'done',
      stopReason: 'end_turn',
    });
  });

  it('surfaces an abort as an abort, not as a cut-off stream', async () => {
    const controller = new AbortController();
    const reason = new DOMException('stopped', 'AbortError');
    const fetch = (async () => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode('data: {"type":"x"}\n\n'));
          controller.abort(reason);
          stream.close();
        },
      });

      return new Response(body);
    }) as typeof globalThis.fetch;

    await expect(
      collect(provider(fetch).stream(request({ signal: controller.signal }))),
    ).rejects.toBe(reason);
  });
});
