import { describe, expect, it } from 'vitest';
import { collect } from '@sheavly/core/testing/fake-fetch.fake';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import { ProviderSwitch } from '../switch.service.js';

const request: ProviderRequest = { messages: [], tools: [], signal: new AbortController().signal };

/** Test-only provider that always says its own name. */
function named(name: string): Provider {
  return {
    async *stream() {
      yield { type: 'text_delta', text: name };
      yield { type: 'done', stopReason: 'end_turn' };
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
});
