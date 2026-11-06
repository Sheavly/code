import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { fakeFetchSequence } from '@sheavly/testing/fetch/fake-fetch.fake';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { createDefaultRegistry } from '@sheavly/providers/registry/default-registry.helper';
import { createResponsesProvider } from '@sheavly/providers/responses/responses.helper';
import { ProviderSwitch } from '@sheavly/providers/switch/switch.service';
import { lookupCall, reasoningItem } from '@sheavly/providers/testing/responses-items.fake';
import { TEST_REQUEST } from '@sheavly/providers/testing/request.constants';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

// Integration: the providers package driven by the real loop, as a host wires them.

const SOURCE = 'responses:https://example.test/v1#m';
const functionCall = lookupCall();

const lookup = defineTool({
  name: 'lookup',
  description: 'Look up a key',
  inputSchema: z.object({ key: z.string() }),
  execute: async ({ input: { key } }) => `value of ${key}`,
});

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

const ask = (provider: Provider) =>
  runAgent({ provider, tools: [lookup], messages: [{ role: 'user', content: 'what is x?' }] });

describe('reasoning items: full tool-call round-trip through runAgent', () => {
  it('keeps reasoning in history and resends it on the next turn, in order', async () => {
    const { fetch, requests } = fakeFetchSequence({ responses: turns });
    const messages = await ask(
      createResponsesProvider({
        endpoint: { baseUrl: 'https://example.test/v1', model: 'm', headers: {} },
        request: TEST_REQUEST,
        fetch,
      }),
    );

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
    ['openai', { apiKey: 'k', model: 'gpt-6.1-sol' }],
    [
      'azure-openai',
      { apiKey: 'k', baseUrl: 'https://res.openai.azure.com/openai/v1', deployment: 'gpt-6.1-sol' },
    ],
  ] as const)('works through the %s adapter', async (kind, adapterConfig) => {
    const { fetch, requests } = fakeFetchSequence({ responses: turns });

    await ask(
      createDefaultRegistry({ fetch }).create(kind, { ...adapterConfig, request: TEST_REQUEST }),
    );

    expect(requests[0]?.body.include).toEqual(['reasoning.encrypted_content']);
    expect(requests[1]?.body.input).toContainEqual(reasoningItem(1));
  });

  it('is off when an adapter config turns it off', async () => {
    const { fetch, requests } = fakeFetchSequence({ responses: turns });

    await ask(
      createDefaultRegistry({ fetch }).create('openai', {
        apiKey: 'k',
        model: 'gpt-6.1-sol',
        reasoning: false,
        request: TEST_REQUEST,
      }),
    );

    expect(requests[0]?.body).not.toHaveProperty('include');
    expect(requests[1]?.body.input).not.toContainEqual(reasoningItem(1));
  });
});

describe('ProviderSwitch in a running agent', () => {
  /** Test-only provider that says its own name, and asks for a tool on the first one. */
  const named = (name: string, callsTool: boolean): Provider => ({
    async *stream() {
      yield { type: 'text_delta', text: name };

      if (callsTool) {
        yield {
          type: 'tool_call',
          call: { id: callIdSchema.parse('1'), name: 'missing', input: {} },
        };
      }

      yield { type: 'done', stopReason: callsTool ? 'tool_use' : 'end_turn' };
    },
  });

  it('swaps between turns', async () => {
    const providers = new ProviderSwitch().add('a', named('a', true)).add('b', named('b', false));

    const messages = await runAgent({
      provider: providers,
      tools: [],
      messages: [{ role: 'user', content: 'go' }],
      onEvent: (event) => {
        if (event.type === 'turn_end' && event.turn === 1) providers.use('b');
      },
    });

    const replies = messages.flatMap((m) => (m.role === 'assistant' ? [m.content] : []));

    expect(replies).toEqual(['a', 'b']);
  });
});
