import { describe, expect, it } from 'vitest';
import { collect, fakeFetch } from '@sheavly/core/testing/fake-fetch.fake';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { lookupCall, reasoningItem } from '../../testing/responses-items.fake.js';
import { createResponsesProvider } from '../responses.helper.js';

const signal = new AbortController().signal;
const config = { endpoint: { baseUrl: 'https://example.test/v1', model: 'm', headers: {} } };
const SOURCE = 'responses:https://example.test/v1#m';
const functionCall = lookupCall();

describe('reasoning items: response side', () => {
  it('emits encrypted reasoning items tagged with their source', async () => {
    const { fetch } = fakeFetch([
      { type: 'response.output_item.done', item: reasoningItem(1) },
      { type: 'response.output_item.done', item: functionCall },
    ]);
    const events = await collect(
      createResponsesProvider({ ...config, fetch }).stream({ messages: [], tools: [], signal }),
    );

    expect(events[0]).toEqual({
      type: 'reasoning',
      item: { source: SOURCE, data: reasoningItem(1) },
    });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it("ignores reasoning items without encrypted content (they can't be resent statelessly)", async () => {
    const { fetch } = fakeFetch([
      { type: 'response.output_item.done', item: { type: 'reasoning', id: 'rs_1' } },
    ]);
    const events = await collect(
      createResponsesProvider({ ...config, fetch }).stream({ messages: [], tools: [], signal }),
    );

    expect(events).toEqual([{ type: 'done', stopReason: 'end_turn' }]);
  });
});

describe('reasoning items: request side', () => {
  const history = (source: string): ProviderRequest => ({
    messages: [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'lookup', input: { key: 'x' } }],
        reasoning: [{ source, data: reasoningItem(1) }],
      },
      { role: 'tool', toolCallId: 'c1', content: 'value', isError: false },
    ],
    tools: [],
    signal,
  });

  it('asks for encrypted reasoning and resends it before the function call it led to', async () => {
    const { fetch, requests } = fakeFetch([]);

    await collect(createResponsesProvider({ ...config, fetch }).stream(history(SOURCE)));

    expect(requests[0]?.body.include).toEqual(['reasoning.encrypted_content']);
    expect(requests[0]?.body.store).toBe(false);
    expect(requests[0]?.body.input).toEqual([
      { role: 'user', content: 'go' },
      reasoningItem(1),
      { type: 'function_call', call_id: 'c1', name: 'lookup', arguments: '{"key":"x"}' },
      { type: 'function_call_output', call_id: 'c1', output: 'value' },
    ]);
  });

  it('drops reasoning produced by a different backend or model (e.g. after a runtime swap)', async () => {
    const { fetch, requests } = fakeFetch([]);

    await collect(
      createResponsesProvider({ ...config, fetch }).stream(history('responses:https://other#m')),
    );
    expect(requests[0]?.body.input).not.toContainEqual(reasoningItem(1));
  });

  it('can be turned off: no include, nothing resent, nothing captured', async () => {
    const { fetch, requests } = fakeFetch([
      { type: 'response.output_item.done', item: reasoningItem(2) },
    ]);
    const events = await collect(
      createResponsesProvider({ ...config, reasoning: false, fetch }).stream(history(SOURCE)),
    );

    expect(requests[0]?.body).not.toHaveProperty('include');
    expect(requests[0]?.body.input).not.toContainEqual(reasoningItem(1));
    expect(events).toEqual([{ type: 'done', stopReason: 'end_turn' }]);
  });
});
