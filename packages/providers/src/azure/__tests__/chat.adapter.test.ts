import { describe, expect, it } from 'vitest';
import { collect, fakeFetchSequence } from '@sheavly/testing/fetch/fake-fetch.fake';
import { azureChatAdapter } from '../chat.adapter.js';
import { azureOpenaiAdapter } from '../openai.adapter.js';
import { TEST_REQUEST } from '../../testing/request.constants.js';

/** Streams one hello through the adapter and returns the request it sent. */
async function sentBy(config: object) {
  const fake = fakeFetchSequence({
    responses: [[{ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }]],
    complete: false,
  });
  const provider = azureChatAdapter.create({
    deps: { fetch: fake.fetch },
    config: azureChatAdapter.configSchema.parse({
      apiKey: 'private',
      request: TEST_REQUEST,
      ...config,
    }),
  });

  await collect(
    provider.stream({
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      signal: new AbortController().signal,
    }),
  );

  return fake.requests[0];
}

describe('Azure Foundry Chat Completions', () => {
  it.each([
    [
      'https://resource.test/models/chat/completions?api-version=2024-05-01-preview',
      undefined,
      '2024-05-01-preview',
    ],
    ['https://resource.test/models/', '2024-05-01-preview', '2024-05-01-preview'],
    [
      'https://resource.test/models/chat/completions?api-version=2024-05-01-preview',
      '2025-04-01-preview',
      '2025-04-01-preview',
    ],
  ])(
    'preserves the portal endpoint without appending Responses (%s)',
    async (baseUrl, apiVersion, expected) => {
      const request = await sentBy({ baseUrl, apiVersion, deployment: 'DeepSeek-V4-Flash' });

      expect(request?.url).toBe(
        `https://resource.test/models/chat/completions?api-version=${expected}`,
      );
      expect(request?.headers['api-key']).toBe('private');
      expect(request?.body.model).toBe('DeepSeek-V4-Flash');
      expect(request?.body.max_tokens).toBe(384_000);
    },
  );

  it.each([
    ['DeepSeek-V4.1-Flash-1017', undefined, 384_000],
    ['deepseek-flash', undefined, 384_000],
    ['DeepSeek-V4-Flash', 4096, 4096],
    ['custom-deployment', undefined, undefined],
    ['constructor', undefined, undefined],
  ])('sends max_tokens for %s (%s) as %s', async (deployment, maxTokens, expected) => {
    const request = await sentBy({
      baseUrl: 'https://resource.test/models/chat/completions?api-version=2024-05-01-preview',
      deployment,
      maxTokens,
    });

    if (expected === undefined) expect(request?.body).not.toHaveProperty('max_tokens');
    else expect(request?.body.max_tokens).toBe(expected);
  });

  it.each([
    [undefined, 'xhigh'],
    ['openai', 'xhigh'],
    ['deepseek', 'max'],
  ])('forwards explicit effort profile %s to the protocol', async (effortProfile, expected) => {
    const fake = fakeFetchSequence({
      responses: [[{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]],
      complete: false,
    });
    const config = azureChatAdapter.configSchema.parse({
      baseUrl: 'https://resource.test/models/chat/completions?api-version=2024-05-01-preview',
      deployment: 'DeepSeek-V4.1-Flash-1017',
      apiKey: 'fake-key',
      effortProfile,
      thinkingMode: 'enabled',
      replayReasoning: true,
      request: TEST_REQUEST,
    });
    const provider = azureChatAdapter.create({ config, deps: { fetch: fake.fetch } });

    await collect(
      provider.stream({
        messages: [{ role: 'user', content: 'hello' }],
        tools: [],
        effort: 'extreme',
        signal: new AbortController().signal,
      }),
    );
    expect(config.effortProfile).toBe(effortProfile ?? 'openai');
    expect(fake.requests[0]?.body.reasoning_effort).toBe(expected);
    expect(fake.requests[0]?.body.thinking).toEqual({ type: 'enabled' });
    expect(fake.requests[0]?.headers['extra-parameters']).toBe('pass-through');
  });

  it('rejects unknown effort profiles rather than silently defaulting', () => {
    expect(
      azureChatAdapter.configSchema.safeParse({
        baseUrl: 'https://resource.test/models',
        deployment: 'custom',
        apiKey: 'fake-key',
        request: TEST_REQUEST,
        effortProfile: 'automatic',
      }).success,
    ).toBe(false);
  });

  it('rejects mixed protocols and invalid API versions before sending a request', () => {
    const config = { deployment: 'model', apiKey: 'key', request: TEST_REQUEST };

    expect(
      azureOpenaiAdapter.configSchema.safeParse({
        ...config,
        baseUrl: 'https://resource.test/models/chat/completions',
      }).success,
    ).toBe(false);
    expect(
      azureChatAdapter.configSchema.safeParse({
        ...config,
        baseUrl: 'https://resource.test/openai/v1/responses',
      }).success,
    ).toBe(false);
    expect(
      azureChatAdapter.configSchema.safeParse({
        ...config,
        baseUrl: 'https://resource.test/models/chat/completions?api-version=bad',
      }).success,
    ).toBe(false);
  });
});
