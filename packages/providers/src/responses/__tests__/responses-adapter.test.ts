import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { collect, fakeFetch } from '@sheavly/testing/fetch/fake-fetch.fake';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { defineResponsesAdapter } from '../responses.helper.js';

const request: ProviderRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  tools: [],
  signal: new AbortController().signal,
};

const exampleAdapter = defineResponsesAdapter({
  kind: 'example',
  description: 'An example Responses backend',
  configSchema: z.object({ token: z.string(), reasoning: z.boolean().default(true) }),
  toEndpoint: (config) => ({
    baseUrl: 'https://example.test/v1',
    model: 'm',
    headers: { 'x-token': config.token },
    query: { tenant: 't1' },
  }),
});

describe('defineResponsesAdapter', () => {
  it('builds a Responses provider from the endpoint its config maps to', async () => {
    const { fetch, requests } = fakeFetch([]);
    const config = exampleAdapter.configSchema.parse({ token: 'secret' });

    await collect(exampleAdapter.create({ config, deps: { fetch } }).stream(request));

    expect(requests[0]?.url).toBe('https://example.test/v1/responses?tenant=t1');
    expect(requests[0]?.headers['x-token']).toBe('secret');
    expect(requests[0]?.body.model).toBe('m');
    expect(requests[0]?.body.include).toEqual(['reasoning.encrypted_content']);
  });

  it("passes the config's reasoning setting to the provider", async () => {
    const { fetch, requests } = fakeFetch([]);
    const config = exampleAdapter.configSchema.parse({ token: 'secret', reasoning: false });

    await collect(exampleAdapter.create({ config, deps: { fetch } }).stream(request));

    expect(requests[0]?.body).not.toHaveProperty('include');
  });
});
