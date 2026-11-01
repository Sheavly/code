import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { collect, fakeFetch } from '../../../testing/fake-fetch.fake.js';
import { defineAdapter } from '@sheavly/core/adapter/adapter.service';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import { createDefaultRegistry } from '../../adapters/adapters.service.js';
import { DEFAULT_ADAPTER, DEFAULT_MODEL } from '../../adapters/adapters.constants.js';
import { AdapterRegistry } from '../registry.service.js';

const request: ProviderRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  tools: [],
  signal: new AbortController().signal,
};

describe('AdapterRegistry', () => {
  it("validates config with the adapter's zod schema", () => {
    const registry = createDefaultRegistry();

    expect(() => registry.create('openai', {})).toThrow('Invalid config for openai');
    expect(() =>
      registry.create('azure', { apiKey: 'k', baseUrl: 'not a url', deployment: 'd' }),
    ).toThrow('Invalid config for azure');
    expect(() =>
      registry.create('azure', {
        apiKey: 'k',
        baseUrl: 'https://res.openai.azure.com/openai/v1',
        deployment: 'd',
        apiVersion: 'not-a-version-looks-like-a-key',
      }),
    ).toThrow('Expected v1, preview, or a date');
  });

  it('rejects unknown kinds and lists what is available', () => {
    expect(() => createDefaultRegistry().create('nope', {})).toThrow(
      'Unknown adapter: nope (available: openai, azure, astra)',
    );
  });

  it('rejects duplicate registrations', () => {
    expect(() =>
      createDefaultRegistry().register(defineAdapter({ ...stubAdapter, kind: 'openai' })),
    ).toThrow('Adapter already registered: openai');
  });

  it('accepts new adapters without touching built-in code', () => {
    const registry = new AdapterRegistry().register(stubAdapter);

    expect(registry.kinds()).toEqual(['stub']);
    expect(registry.create('stub', { reply: 'x' })).toBeDefined();
  });
});

describe('defaults', () => {
  it('defaults to OpenAI with GPT-6.1 Sol, not Astra', async () => {
    expect(DEFAULT_ADAPTER).toBe('openai');
    expect(DEFAULT_MODEL).toBe('gpt-6.1-sol');

    const { fetch, requests } = fakeFetch([]);

    await collect(
      createDefaultRegistry({ fetch }).create(DEFAULT_ADAPTER, { apiKey: 'k' }).stream(request),
    );
    expect(requests[0]?.body.model).toBe('gpt-6.1-sol');
  });

  it('requires Astra users to pick a model explicitly', () => {
    expect(() => createDefaultRegistry().create('astra', { apiKey: 'k' })).toThrow(
      'Invalid config for astra',
    );
  });
});

describe('built-in adapters', () => {
  const cases = [
    {
      kind: 'openai',
      config: { apiKey: 'sk-1' },
      url: 'https://api.openai.com/v1/responses',
      model: 'gpt-6.1-sol',
      auth: ['authorization', 'Bearer sk-1'],
    },
    {
      kind: 'azure',
      config: {
        apiKey: 'az-1',
        baseUrl: 'https://res.openai.azure.com/openai/v1/',
        deployment: 'my-deploy',
      },
      url: 'https://res.openai.azure.com/openai/v1/responses',
      model: 'my-deploy',
      auth: ['api-key', 'az-1'],
    },
    {
      kind: 'azure',
      config: {
        apiKey: 'az-2',
        baseUrl: 'https://res.cognitiveservices.azure.com/openai',
        deployment: 'gpt-6.1-sol',
        apiVersion: '2025-04-01-preview',
      },
      url: 'https://res.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview',
      model: 'gpt-6.1-sol',
      auth: ['api-key', 'az-2'],
    },
    {
      kind: 'azure',
      config: {
        apiKey: 'az-3',
        baseUrl:
          'https://res.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview',
        deployment: 'gpt-6.1-sol',
      },
      url: 'https://res.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview',
      model: 'gpt-6.1-sol',
      auth: ['api-key', 'az-3'],
    },
    {
      kind: 'astra',
      config: { apiKey: 'as-1', model: 'openai/gpt-6-luna' },
      url: 'https://platform.astragpt.net/api/v1/responses',
      model: 'openai/gpt-6-luna',
      auth: ['authorization', 'Bearer as-1'],
    },
  ] as const;

  for (const { kind, config, url, model, auth } of cases) {
    it(`${kind} calls ${url}`, async () => {
      const { fetch, requests } = fakeFetch([]);
      const provider = createDefaultRegistry({ fetch }).create(kind, config);

      await collect(provider.stream(request));

      expect(requests[0]?.url).toBe(url);
      expect(requests[0]?.headers[auth[0]]).toBe(auth[1]);
      expect(requests[0]?.body.model).toBe(model);
    });
  }
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
