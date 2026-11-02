import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineAdapter } from '@sheavly/core/adapter/adapter.service';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { createDefaultRegistry } from '../default-registry.service.js';
import { AdapterRegistry } from '../registry.service.js';

describe('AdapterRegistry', () => {
  it("validates config with the adapter's zod schema", () => {
    const registry = new AdapterRegistry().register(stubAdapter);

    expect(() => registry.create('stub', {})).toThrow('Invalid config for stub');
  });

  it('rejects unknown kinds and lists what is available', () => {
    expect(() => new AdapterRegistry().register(stubAdapter).create('nope', {})).toThrow(
      'Unknown adapter: nope (available: stub)',
    );
  });

  it('rejects duplicate registrations', () => {
    expect(() => new AdapterRegistry().register(stubAdapter).register(stubAdapter)).toThrow(
      'Adapter already registered: stub',
    );
  });

  it('accepts new adapters without touching built-in code', () => {
    const registry = new AdapterRegistry().register(stubAdapter);

    expect(registry.kinds()).toEqual(['stub']);
    expect(registry.create('stub', { reply: 'x' })).toBeDefined();
  });
});

describe('createDefaultRegistry', () => {
  it('has the built-in adapters, and no default model of its own', () => {
    const registry = createDefaultRegistry();

    expect(registry.kinds()).toEqual(['openai', 'azure']);
    expect(() => registry.create('openai', { apiKey: 'k' })).toThrow('Invalid config for openai');
  });
});

/** Test-only adapter showing the extension point. */
const stubAdapter = defineAdapter({
  kind: 'stub',
  description: 'Replies with fixed text',
  configSchema: z.object({ reply: z.string() }),
  create: ({ config: { reply } }): Provider => ({
    async *stream() {
      yield { type: 'text_delta', text: reply };
      yield { type: 'done', stopReason: 'end_turn' };
    },
  }),
});
