import { describe, expect, it } from 'vitest';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { collect, requestSentBy } from '@sheavly/testing/fetch/fake-fetch.fake';
import { TEST_REQUEST } from '../../testing/request.constants.js';
import { bedrockAnthropicAdapter } from '../anthropic.adapter.js';
import { bedrockOpenaiAdapter } from '../openai.adapter.js';

const clock = useFixedClock(); // 2023-11-14T22:13:20Z
const SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
const keyPair = { auth: 'access-key', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: SECRET };
const claude = {
  ...keyPair,
  region: 'us-east-1',
  model: 'us.anthropic.claude-sonnet-5-5',
  maxTokens: 64,
  request: TEST_REQUEST,
};
const gpt = {
  ...keyPair,
  region: 'us-east-1',
  model: 'us.openai.gpt-6-astra',
  request: TEST_REQUEST,
};

type Send = (overrides?: object) => ReturnType<typeof requestSentBy>;

const sendClaude: Send = (overrides = {}) =>
  requestSentBy({
    adapter: bedrockAnthropicAdapter,
    config: { ...claude, ...overrides },
    reply: [{ type: 'message_stop' }],
  });
const sendGpt: Send = (overrides = {}) =>
  requestSentBy({ adapter: bedrockOpenaiAdapter, config: { ...gpt, ...overrides } });

describe.each([
  ['bedrock-anthropic', sendClaude],
  ['bedrock-openai', sendGpt],
] as const)('%s signed in with an access key pair', (_kind, sent) => {
  it('signs the request for bedrock in its Region, and sends no API key', async () => {
    const request = await sent();

    expect(request?.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20231114\/us-east-1\/bedrock\/aws4_request, SignedHeaders=.*host.*x-amz-date.*, Signature=[0-9a-f]{64}$/,
    );
    expect(request?.headers['x-amz-date']).toBe('20231114T221320Z');
    expect(request?.headers).not.toHaveProperty('x-api-key');
    expect(request?.headers).not.toHaveProperty('x-amz-security-token');
  });

  it('signs for the Region the model names', async () => {
    const request = await sent({ region: 'eu-west-1' });

    expect(request?.headers.authorization).toContain('/20231114/eu-west-1/bedrock/aws4_request');
  });

  it('sends a session token with, and signs it, for temporary credentials', async () => {
    const request = await sent({ sessionToken: 'session-token-value' });

    expect(request?.headers['x-amz-security-token']).toBe('session-token-value');
    expect(request?.headers.authorization).toContain('x-amz-security-token');
  });

  it('never puts the secret key in what it sends', async () => {
    const request = await sent({ sessionToken: 'session-token-value' });
    const everything = JSON.stringify([request?.headers, request?.body, request?.url]);

    expect(everything).not.toContain(SECRET);
    expect(JSON.stringify(request?.body)).not.toContain('session-token-value');
  });
});

describe('signing in to Bedrock with an access key pair', () => {
  it('signs every attempt anew: a retry carries the time it is sent at', async () => {
    const dates: string[] = [];
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      dates.push(new Headers(init?.headers).get('x-amz-date') ?? '');
      clock.advance(60_000);

      return dates.length === 1
        ? new Response('busy', { status: 503 })
        : new Response('data: {"type":"message_stop"}\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          });
    }) as typeof globalThis.fetch;
    const provider = bedrockAnthropicAdapter.create({
      config: bedrockAnthropicAdapter.configSchema.parse({
        ...claude,
        request: { responseTimeoutMs: 1000, retries: 1, retryDelayMs: 0 },
      }),
      deps: { fetch },
    });

    await collect(
      provider.stream({
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
        signal: new AbortController().signal,
      }),
    );

    expect(dates).toEqual(['20231114T221320Z', '20231114T221420Z']);
  });

  it.each([
    ['an API key with no key given', { auth: 'api-key', apiKey: undefined }, 'apiKey'],
    ['an access key with no key id', { accessKeyId: undefined }, 'accessKeyId'],
    ['an access key with no secret', { secretAccessKey: undefined }, 'secretAccessKey'],
    ['both an API key and an access key pair', { apiKey: 'bk-key' }, 'apiKey'],
    [
      'an access key pair under API key credentials',
      { auth: 'api-key', apiKey: 'bk-key' },
      'accessKeyId',
    ],
    ['credentials that are not chosen', { auth: undefined }, 'auth'],
  ])('refuses %s, naming the field and never a secret', (_name, overrides, field) => {
    const parsed = bedrockAnthropicAdapter.configSchema.safeParse({ ...claude, ...overrides });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path[0])).toContain(field);
    expect(JSON.stringify(parsed.error?.issues)).not.toContain(SECRET);
    expect(JSON.stringify(parsed.error?.issues)).not.toContain('bk-key');
  });

  it('accepts an API key with its own mode, which is what API-key models already use', () => {
    const { accessKeyId: _id, secretAccessKey: _secret, ...rest } = claude;

    expect(
      bedrockAnthropicAdapter.configSchema.safeParse({ ...rest, auth: 'api-key', apiKey: 'bk-key' })
        .success,
    ).toBe(true);
  });
});
