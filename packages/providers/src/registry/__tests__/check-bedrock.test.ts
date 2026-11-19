import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../default-registry.helper.js';

const KEY = 'bk-LEAK-CHECK-4d81e07b';
const claude = {
  apiKey: KEY,
  region: 'us-east-1',
  model: 'us.anthropic.claude-sonnet-5-5',
  maxTokens: 64,
};
const gpt = { apiKey: KEY, region: 'us-east-1', model: 'us.openai.gpt-6-astra' };

/** Every call is answered with `status`, and a body that echoes the key, as a provider might. */
const refusing = (status: number) =>
  (async () => new Response(`denied ${KEY}`, { status })) as unknown as typeof globalThis.fetch;
const checked = (params: { kind: string; config: Record<string, unknown>; status: number }) =>
  createDefaultRegistry({ fetch: refusing(params.status) }).check({
    kind: params.kind,
    config: params.config,
  });

describe('the connection check of a Bedrock model', () => {
  it.each([
    ['bedrock-anthropic', claude],
    ['bedrock-openai', gpt],
  ])('explains a 403 of %s as a refused key or missing model access', async (kind, config) => {
    const result = await checked({ kind, config, status: 403 });

    expect(result).toMatchObject({
      status: 'invalid',
      message: expect.stringMatching(/model access.*Region|Region.*model access/) as string,
    });
  });

  it('explains a 404 as an unknown profile or Region, and keeps the status', async () => {
    const result = await checked({ kind: 'bedrock-anthropic', config: claude, status: 404 });

    expect(result).toMatchObject({
      status: 'not_found',
      message: expect.stringContaining('inference profile') as string,
    });
  });

  it('falls back to Bedrock’s own words on a 400', async () => {
    const result = await checked({ kind: 'bedrock-anthropic', config: claude, status: 400 });

    expect(result).toMatchObject({
      status: 'rejected',
      message: expect.stringContaining('Bedrock rejected the request') as string,
    });
  });

  it.each([403, 404, 400, 429, 500, 503])(
    'never sends back what Bedrock said on a %i, so an echoed key cannot come out',
    async (status) => {
      const result = await checked({ kind: 'bedrock-openai', config: gpt, status });

      expect(JSON.stringify(result)).not.toContain(KEY);
    },
  );

  it('leaves the other adapters’ messages as they were', async () => {
    const result = await checked({
      kind: 'azure-anthropic',
      config: {
        apiKey: KEY,
        baseUrl: 'https://res.services.ai.azure.com/anthropic',
        deployment: 'd',
      },
      status: 403,
    });

    expect(result).toEqual({ status: 'invalid', message: 'The provider refused the key' });
  });
});
