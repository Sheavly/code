import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runAgent } from '../../../loop/stream-agent/stream-agent.service.js';
import { collect, fakeFetch, fakeFetchSequence } from '../../../testing/fake-fetch.fake.js';
import { defineTool } from '@sheavly/core/tool/tool.service';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { createDefaultRegistry } from '../../adapters/adapters.service.js';
import { createResponsesProvider } from '../responses.service.js';

const signal = new AbortController().signal;
const config = { baseUrl: 'https://example.test/v1', model: 'm', headers: {} };
const SOURCE = 'responses:https://example.test/v1#m';

/** What a Responses API reasoning output item looks like with store=false + include. */
const reasoningItem = (n: number) => ({
  type: 'reasoning',
  id: `rs_${n}`,
  summary: [],
  encrypted_content: `encrypted-${n}`,
});

const functionCall = {
  type: 'function_call',
  call_id: 'c1',
  name: 'lookup',
  arguments: '{"description":"looking it up","key":"x"}',
};

const lookup = defineTool({
  name: 'lookup',
  description: 'Look up a key',
  inputSchema: z.object({ key: z.string() }),
  execute: async ({ input: { key } }) => `value of ${key}`,
});

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

describe('reasoning items: full tool-call round-trip through runAgent', () => {
  const turns = [
    [
      { type: 'response.output_item.done', item: reasoningItem(1) },
      { type: 'response.output_item.done', item: functionCall },
    ],
    [
      { type: 'response.output_item.done', item: reasoningItem(2) },
      { type: 'response.output_text.delta', delta: 'The value is x.' },
    ],
  ];

  it('keeps reasoning in history and resends it on the next turn, in order', async () => {
    const { fetch, requests } = fakeFetchSequence({ responses: turns });
    const messages = await runAgent({
      provider: createResponsesProvider({ ...config, fetch }),
      tools: [lookup],
      messages: [{ role: 'user', content: 'what is x?' }],
    });

    // Stored on the assistant messages, in history.
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      reasoning: [{ source: SOURCE, data: reasoningItem(1) }],
    });
    expect(messages[3]).toMatchObject({
      role: 'assistant',
      reasoning: [{ source: SOURCE, data: reasoningItem(2) }],
    });

    // Resent on turn 2: reasoning → function call → its output.
    expect(requests).toHaveLength(2);
    expect(requests[1]?.body.input).toEqual([
      { role: 'user', content: 'what is x?' },
      reasoningItem(1),
      { type: 'function_call', call_id: 'c1', name: 'lookup', arguments: functionCall.arguments },
      { type: 'function_call_output', call_id: 'c1', output: 'value of x' },
    ]);
  });

  it.each([
    ['openai', { apiKey: 'k' }],
    [
      'azure',
      { apiKey: 'k', baseUrl: 'https://res.openai.azure.com/openai/v1', deployment: 'gpt-6.1-sol' },
    ],
  ] as const)('works through the %s adapter', async (kind, adapterConfig) => {
    const { fetch, requests } = fakeFetchSequence({ responses: turns });

    await runAgent({
      provider: createDefaultRegistry({ fetch }).create(kind, adapterConfig),
      tools: [lookup],
      messages: [{ role: 'user', content: 'what is x?' }],
    });

    expect(requests[0]?.body.include).toEqual(['reasoning.encrypted_content']);
    expect(requests[1]?.body.input).toContainEqual(reasoningItem(1));
  });

  it('is off when an adapter config turns it off', async () => {
    const { fetch, requests } = fakeFetchSequence({ responses: turns });

    await runAgent({
      provider: createDefaultRegistry({ fetch }).create('openai', {
        apiKey: 'k',
        reasoning: false,
      }),
      tools: [lookup],
      messages: [{ role: 'user', content: 'what is x?' }],
    });
    expect(requests[0]?.body).not.toHaveProperty('include');
    expect(requests[1]?.body.input).not.toContainEqual(reasoningItem(1));
  });
});
