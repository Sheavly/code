import { describe, expect, it } from 'vitest';
import { collect, fakeFetch } from '@sheavly/testing/fetch/fake-fetch.fake';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { lookupCall, reasoningItem } from '../../testing/responses-items.fake.js';
import { TEST_REQUEST } from '../../testing/request.constants.js';
import { createResponsesProvider } from '../responses.helper.js';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

const c1 = callIdSchema.parse('c1');
const signal = new AbortController().signal;
const config = {
  endpoint: { baseUrl: 'https://example.test/v1', model: 'm', headers: {} },
  request: TEST_REQUEST,
};
const SOURCE = 'responses:https://example.test/v1#m';
const functionCall = lookupCall();

/** The events the provider yields for a reply made of these stream events. */
function streamed(replies: object[]) {
  const { fetch } = fakeFetch(replies);

  return collect(
    createResponsesProvider({ ...config, fetch }).stream({ messages: [], tools: [], signal }),
  );
}

describe('reasoning items: response side', () => {
  it('emits encrypted reasoning items tagged with their source', async () => {
    const events = await streamed([
      { type: 'response.output_item.done', item: reasoningItem(1) },
      { type: 'response.output_item.done', item: functionCall },
    ]);

    expect(events.slice(0, 2)).toEqual([
      { type: 'reasoning_activity', active: false },
      { type: 'reasoning', item: { source: SOURCE, data: reasoningItem(1) } },
    ]);
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it("signals activity for reasoning items without encrypted content but doesn't replay them", async () => {
    const events = await streamed([
      { type: 'response.output_item.added', item: { type: 'reasoning', id: 'rs_1' } },
      { type: 'response.output_item.done', item: { type: 'reasoning', id: 'rs_1' } },
    ]);

    expect(events.map((event) => event.type)).toEqual([
      'reasoning_activity',
      'reasoning_activity',
      'done',
    ]);
    expect(events.map((event) => ('active' in event ? event.active : null))).toEqual([
      true,
      false,
      null,
    ]);
  });

  it('treats an empty encrypted_content as no replay state, while still signalling activity', async () => {
    const events = await streamed([
      {
        type: 'response.output_item.done',
        item: { type: 'reasoning', id: 'rs_1', encrypted_content: '' },
      },
    ]);

    expect(events.map((event) => event.type)).toEqual(['reasoning_activity', 'done']);
  });

  it('ignores added items that are not reasoning', async () => {
    const events = await streamed([
      { type: 'response.output_item.added', item: { type: 'message' } },
    ]);

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
        toolCalls: [{ id: c1, name: 'lookup', input: { key: 'x' } }],
        reasoning: [{ source, data: reasoningItem(1) }],
      },
      { role: 'tool', toolCallId: c1, content: 'value', isError: false },
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
    // Replay is off, but the live activity signal is independent of it.
    expect(events).toEqual([
      { type: 'reasoning_activity', active: false },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });
});
