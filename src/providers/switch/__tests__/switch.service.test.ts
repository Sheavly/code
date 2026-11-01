import { describe, expect, it } from 'vitest';
import { runAgent } from '../../../loop/stream-agent/stream-agent.service.js';
import { collect } from '../../../testing/fake-fetch.fake.js';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import { ProviderSwitch } from '../switch.service.js';

const request: ProviderRequest = { messages: [], tools: [], signal: new AbortController().signal };

/** Test-only provider that always says its own name. */
function named(name: string, stopReason: 'end_turn' | 'tool_use' = 'end_turn'): Provider {
  return {
    async *stream() {
      yield { type: 'text_delta', text: name };

      if (stopReason === 'tool_use') {
        yield { type: 'tool_call', call: { id: '1', name: 'missing', input: {} } };
      }

      yield { type: 'done', stopReason };
    },
  };
}

const text = (events: StreamEvent[]) =>
  events.flatMap((e) => (e.type === 'text_delta' ? [e.text] : [])).join('');

describe('ProviderSwitch', () => {
  it('uses the first added provider by default', async () => {
    const providers = new ProviderSwitch().add('a', named('a')).add('b', named('b'));

    expect(providers.active).toBe('a');
    expect(text(await collect(providers.stream(request)))).toBe('a');
  });

  it('swaps at runtime', async () => {
    const providers = new ProviderSwitch().add('a', named('a')).add('b', named('b'));

    providers.use('b');
    expect(text(await collect(providers.stream(request)))).toBe('b');
  });

  it('lets an in-flight stream finish on the provider it started with', async () => {
    const providers = new ProviderSwitch().add('a', named('a')).add('b', named('b'));
    const stream = providers.stream(request);

    providers.use('b');
    expect(text(await collect(stream))).toBe('a');
  });

  it('rejects unknown names and empty switches', () => {
    const providers = new ProviderSwitch();

    expect(() => providers.stream(request)).toThrow('No active provider');
    expect(() => providers.use('x')).toThrow('Unknown provider: x (available: none)');
  });

  it('swaps between turns of a running agent', async () => {
    const providers = new ProviderSwitch().add('a', named('a', 'tool_use')).add('b', named('b'));

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
