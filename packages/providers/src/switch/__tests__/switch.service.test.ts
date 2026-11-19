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

  it('reports the context window of whichever provider is active, and none when it has none', () => {
    const providers = new ProviderSwitch()
      .add('a', { ...named('a'), contextWindow: 300_000 })
      .add('b', { ...named('b'), contextWindow: 1_000_000 })
      .add('c', named('c'));

    expect(providers.contextWindow).toBe(300_000);
    providers.use('b');
    expect(providers.contextWindow).toBe(1_000_000);
    providers.use('c');
    expect(providers.contextWindow).toBeUndefined();
    expect(new ProviderSwitch().contextWindow).toBeUndefined();
  });

  it('keeps the window of a pinned provider, with or without an effort set', () => {
    const providers = new ProviderSwitch()
      .add('a', { ...named('a'), contextWindow: 300_000 })
      .add('b', { ...named('b'), contextWindow: 1_000_000 });

    expect(providers.pinned('a').contextWindow).toBe(300_000);
    providers.setEffort({ name: 'a', effort: 'high' });
    providers.use('b');
    expect(providers.pinned('a').contextWindow).toBe(300_000);
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

  describe('remove', () => {
    it('falls back to the first remaining provider when the active one goes', async () => {
      const providers = new ProviderSwitch()
        .add('a', named('a'))
        .add('b', named('b'))
        .add('c', named('c'));

      providers.use('b');
      providers.remove('b');

      expect(providers.active).toBe('a');
      expect(providers.names()).toEqual(['a', 'c']);
      expect(text(await collect(providers.stream(request)))).toBe('a');
    });

    it('leaves the active provider when another is removed', () => {
      const providers = new ProviderSwitch().add('a', named('a')).add('b', named('b'));

      providers.remove('b');

      expect(providers.active).toBe('a');
    });

    it('ends with no active provider when the last one goes, and the next add becomes active', () => {
      const providers = new ProviderSwitch().add('a', named('a'));

      providers.remove('a');

      expect(providers.active).toBeUndefined();
      expect(() => providers.stream(request)).toThrow('No active provider');

      providers.add('b', named('b'));

      expect(providers.active).toBe('b');
    });

    it('refuses a name that was never added, naming what is available', () => {
      const providers = new ProviderSwitch().add('a', named('a'));

      expect(() => providers.remove('x')).toThrow('Unknown provider: x (available: a)');
    });

    it('forgets the removed provider effort, so a provider added again under its name starts unset', () => {
      const providers = new ProviderSwitch().add('a', named('a')).add('b', named('b'));

      providers.setEffort({ name: 'a', effort: 'high' });
      providers.remove('a');
      providers.add('a', named('a'));
      providers.use('a');

      expect(providers.activeEffort).toBeUndefined();
    });

    it('changes neither a pinned provider nor a stream already started', async () => {
      const providers = new ProviderSwitch().add('a', named('a')).add('b', named('b'));
      const pinned = providers.pinned('a');
      const started = providers.stream(request);

      providers.remove('a');

      expect(text(await collect(pinned.stream(request)))).toBe('a');
      expect(text(await collect(started))).toBe('a');
      expect(() => providers.pinned('a')).toThrow('Unknown provider: a');
    });
  });

  describe('state table', () => {
    it('add keeps the active provider, and a repeated name replaces its provider', async () => {
      const providers = new ProviderSwitch().add('a', named('first'));

      providers.add('a', named('second'));

      expect(providers.active).toBe('a');
      expect(text(await collect(providers.stream(request)))).toBe('second');
    });

    it('setEffort refuses a provider that was removed', () => {
      const providers = new ProviderSwitch().add('a', named('a')).add('b', named('b'));

      providers.remove('b');

      expect(() => providers.setEffort({ name: 'b', effort: 'low' })).toThrow(
        'Unknown provider: b',
      );
    });

    it('use refuses a removed name and keeps the active provider', () => {
      const providers = new ProviderSwitch().add('a', named('a')).add('b', named('b'));

      providers.remove('b');

      expect(() => providers.use('b')).toThrow('Unknown provider: b');
      expect(providers.active).toBe('a');
    });
  });

  it('captures effort for in-flight streams and pinned providers, while later calls use the new effort', async () => {
    const seen: (string | undefined)[] = [];
    const provider: Provider = {
      async *stream(call) {
        seen.push(call.effort);
        yield { type: 'done', stopReason: 'end_turn' };
      },
    };
    const switching = new ProviderSwitch().add('a', provider);

    switching.setEffort({ name: 'a', effort: 'high' });
    const started = switching.stream(request);
    const child = switching.pinned('a');

    switching.setEffort({ name: 'a', effort: 'low' });
    await collect(started);
    await collect(child.stream(request));
    await collect(switching.stream(request));
    expect(seen).toEqual(['high', 'high', 'low']);
  });
});
