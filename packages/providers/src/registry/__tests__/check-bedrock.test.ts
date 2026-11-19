import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../default-registry.helper.js';

const KEY = 'bk-LEAK-CHECK-4d81e07b';
const claude = {
  auth: 'api-key',
  apiKey: KEY,
  region: 'us-east-1',
  model: 'us.anthropic.claude-sonnet-5-5',
  maxTokens: 64,
};
const gpt = {
  auth: 'api-key',
  apiKey: KEY,
  region: 'us-east-1',
  model: 'us.openai.gpt-6-astra',
};

/** Every call is answered with `status` and `body`, which echoes the key as a provider might. */
const refusing = (params: { status: number; body: string }) =>
  (async () =>
    new Response(params.body, { status: params.status })) as unknown as typeof globalThis.fetch;
const checked = (params: {
  kind: string;
  config: Record<string, unknown>;
  status: number;
  body?: string;
}) =>
  createDefaultRegistry({
    fetch: refusing({ status: params.status, body: params.body ?? `denied ${KEY}` }),
  }).check({ kind: params.kind, config: params.config });

const accessKey = {
  ...claude,
  auth: 'access-key',
  apiKey: undefined,
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: KEY,
};

describe('the connection check of a Bedrock model', () => {
  it('gives Bedrock’s messages to every adapter for Bedrock, which is named bedrock-*', () => {
    // The check picks its messages from the kind's prefix, so a Bedrock adapter named otherwise
    // would silently get the general ones.
    const described = createDefaultRegistry().describe();
    const onBedrock = described.filter(({ description }) => /bedrock/i.test(description));

    expect(onBedrock.length).toBeGreaterThan(0);

    for (const { kind } of onBedrock) expect(kind.startsWith('bedrock-'), kind).toBe(true);

    for (const { kind } of described.filter(({ kind: name }) => name.startsWith('bedrock-'))) {
      expect(
        onBedrock.map((adapter) => adapter.kind),
        kind,
      ).toContain(kind);
    }
  });

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

  it.each([
    [403, '{"__type":"ExpiredTokenException"}', 'session token has expired'],
    [403, 'The security token included in the request is expired', 'session token has expired'],
    [400, '{"__type":"RequestExpired"}', 'clock'],
    [403, 'Signature expired: 20231114T000000Z is now earlier than 20231114T001000Z', 'clock'],
    [403, '{"__type":"SignatureDoesNotMatch"}', 'signature did not match'],
    [
      403,
      'The request signature we calculated does not match the signature you provided',
      'signature did not match',
    ],
    [403, '{"__type":"UnrecognizedClientException"}', 'does not know this access key ID'],
  ])(
    'explains a %i that says %j for a signed request in fixed text',
    async (status, body, words) => {
      const result = await checked({
        kind: 'bedrock-anthropic',
        config: accessKey,
        status,
        body: `${body} ${KEY}`,
      });

      expect(result).toMatchObject({ message: expect.stringContaining(words) as string });
      expect(JSON.stringify(result)).not.toContain(KEY);
      expect(JSON.stringify(result)).not.toContain('Expired');
    },
  );

  it.each(['ExpiredTokenException', 'SignatureDoesNotMatch', 'UnrecognizedClientException'])(
    'does not blame a signature or a session token for a refused API key: %s',
    async (body) => {
      const result = await checked({
        kind: 'bedrock-anthropic',
        config: claude,
        status: 403,
        body,
      });

      expect(result).toMatchObject({ status: 'invalid' });
      expect(JSON.stringify(result)).not.toMatch(/signature|session token|clock/i);
    },
  );

  it('leaves a signature refusal of another provider to the general messages', async () => {
    const result = await checked({
      kind: 'azure-anthropic',
      config: {
        apiKey: KEY,
        baseUrl: 'https://res.services.ai.azure.com/anthropic',
        deployment: 'd',
      },
      status: 403,
      body: 'SignatureDoesNotMatch',
    });

    expect(result).toEqual({ status: 'invalid', message: 'The provider refused the key' });
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
