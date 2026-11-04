import { describe, expect, it } from 'vitest';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
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

  it('hands out a provider that stays on its model whatever the switch is set to', async () => {
    const providers = new ProviderSwitch().add('a', named('a')).add('b', named('b'));
    const pinned = providers.pinned('a');

    providers.use('b');
    expect(text(await collect(pinned.stream(request)))).toBe('a');
    expect(text(await collect(providers.stream(request)))).toBe('b');
  });

  it('refuses to pin to a key that was never added', () => {
    const providers = new ProviderSwitch().add('a', named('a'));

    expect(() => providers.pinned('x')).toThrow('Unknown provider: x (available: a)');
  });

  it('rejects unknown names and empty switches', () => {
    const providers = new ProviderSwitch();

    expect(() => providers.stream(request)).toThrow('No active provider');
    expect(() => providers.use('x')).toThrow('Unknown provider: x (available: none)');
  });
});
