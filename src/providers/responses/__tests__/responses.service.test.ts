import { describe, expect, it } from 'vitest';
import { collect, fakeFetch } from '../../../testing/fake-fetch.fake.js';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { createResponsesProvider } from '../responses.service.js';

const request = (overrides: Partial<ProviderRequest> = {}): ProviderRequest => ({
  messages: [{ role: 'user', content: 'hi' }],
  tools: [],
  signal: new AbortController().signal,
  ...overrides,
});

const provider = (fetch: typeof globalThis.fetch) =>
  createResponsesProvider({
    baseUrl: 'https://example.test/v1',
    model: 'm',
    headers: { 'x-key': 'k' },
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
              toolCalls: [{ id: 'c1', name: 'get_weather', input: { city: 'Oslo' } }],
            },
            { role: 'tool', toolCallId: 'c1', content: 'Sunny', isError: false },
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
