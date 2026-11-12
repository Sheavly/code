import { describe, expect, it } from 'vitest';
import { requestSentBy } from '@sheavly/testing/fetch/fake-fetch.fake';
import { azureAnthropicAdapter } from '../anthropic.adapter.js';
import { TEST_REQUEST } from '../../testing/request.constants.js';

const base = {
  apiKey: 'az-1',
  deployment: 'claude-sonnet',
  maxTokens: 8192,
  request: TEST_REQUEST,
};
const parse = (config: object) =>
  azureAnthropicAdapter.configSchema.safeParse({ ...base, ...config });

describe('azureAnthropicAdapter', () => {
  it.each([
    ['claude-sonnet-5-5', 128_000],
    ['claude-opus-5-5', 128_000],
    ['claude-fable-5-1', 128_000],
    ['claude-haiku-5-5', 128_000],
    ['custom-deployment', 8192],
    ['constructor', 8192],
  ])('uses a safe default for %s when maxTokens is omitted', async (deployment, maxTokens) => {
    const request = await requestSentBy({
      adapter: azureAnthropicAdapter,
      config: {
        apiKey: base.apiKey,
        request: TEST_REQUEST,
        deployment,
        baseUrl: 'https://res.services.ai.azure.com/anthropic',
      },
      reply: [{ type: 'message_stop' }],
    });

    expect(request?.body.max_tokens).toBe(maxTokens);
  });

  it('validates thinking against the resolved model default and preserves an explicit limit', async () => {
    const config = {
      apiKey: base.apiKey,
      request: TEST_REQUEST,
      deployment: 'claude-sonnet-5-5',
      baseUrl: 'https://res.services.ai.azure.com/anthropic',
      thinkingBudget: 8192,
    };

    expect(azureAnthropicAdapter.configSchema.safeParse(config).success).toBe(true);
    expect(
      azureAnthropicAdapter.configSchema.safeParse({ ...config, thinkingBudget: 128_000 }).success,
    ).toBe(false);
    const request = await requestSentBy({
      adapter: azureAnthropicAdapter,
      config: { ...config, thinkingBudget: undefined, maxTokens: 4096 },
      reply: [{ type: 'message_stop' }],
    });

    expect(request?.body.max_tokens).toBe(4096);
  });

  for (const baseUrl of [
    'https://res.services.ai.azure.com/anthropic',
    'https://res.services.ai.azure.com/anthropic/v1/',
    'https://res.services.ai.azure.com/anthropic/v1/messages',
  ]) {
    it(`maps ${baseUrl} to the Messages endpoint, with the key and deployment`, async () => {
      const request = await requestSentBy({
        adapter: azureAnthropicAdapter,
        config: { ...base, baseUrl },
        reply: [{ type: 'message_stop' }],
      });

      expect(request?.url).toBe('https://res.services.ai.azure.com/anthropic/v1/messages');
      expect(request?.headers['x-api-key']).toBe('az-1');
      expect(request?.body).toMatchObject({ model: 'claude-sonnet', max_tokens: 8192 });
    });
  }

  it('rejects a thinking budget under the minimum or not under maxTokens', () => {
    const baseUrl = 'https://res.services.ai.azure.com/anthropic';

    expect(parse({ baseUrl, thinkingBudget: 2048 }).success).toBe(true);
    expect(parse({ baseUrl, thinkingBudget: 512 }).success).toBe(false);
    expect(parse({ baseUrl, thinkingBudget: 8192 }).success).toBe(false);
    expect(parse({ baseUrl: 'not a url' }).success).toBe(false);
  });

  it('sends adaptive thinking without a fixed budget', async () => {
    const request = await requestSentBy({
      adapter: azureAnthropicAdapter,
      config: {
        ...base,
        baseUrl: 'https://res.services.ai.azure.com/anthropic',
        thinkingMode: 'adaptive',
      },
      reply: [{ type: 'message_stop' }],
    });

    expect(request?.body.thinking).toEqual({ type: 'adaptive' });
  });

  it('inherits prompt caching, and turns it off with promptCaching: false', async () => {
    const config = { ...base, baseUrl: 'https://res.services.ai.azure.com/anthropic' };
    const reply = [{ type: 'message_stop' }];
    const on = await requestSentBy({ adapter: azureAnthropicAdapter, config, reply });
    const off = await requestSentBy({
      adapter: azureAnthropicAdapter,
      config: { ...config, promptCaching: false },
      reply,
    });

    expect(on?.body.cache_control).toEqual({ type: 'ephemeral' });
    expect(off?.body).not.toHaveProperty('cache_control');
  });

  it('refuses contradictory thinking settings before making a request', () => {
    const baseUrl = 'https://res.services.ai.azure.com/anthropic';

    expect(parse({ baseUrl, thinkingMode: 'adaptive' }).success).toBe(true);
    expect(parse({ baseUrl, thinkingMode: 'disabled' }).success).toBe(true);
    expect(parse({ baseUrl, thinkingMode: 'enabled' }).success).toBe(false);
    expect(parse({ baseUrl, thinkingMode: 'enabled', thinkingBudget: 2048 }).success).toBe(true);
    expect(parse({ baseUrl, thinkingMode: 'adaptive', thinkingBudget: 2048 }).success).toBe(false);
    expect(parse({ baseUrl, thinkingMode: 'disabled', thinkingBudget: 2048 }).success).toBe(false);
  });
});
