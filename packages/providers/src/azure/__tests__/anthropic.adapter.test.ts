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
