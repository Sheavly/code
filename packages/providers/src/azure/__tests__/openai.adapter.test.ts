import { describe, expect, it } from 'vitest';
import { requestSentBy } from '@sheavly/testing/fetch/fake-fetch.fake';
import { azureOpenaiAdapter } from '../openai.adapter.js';
import { TEST_REQUEST } from '../../testing/request.constants.js';

const sent = (config: unknown) =>
  requestSentBy({
    adapter: azureOpenaiAdapter,
    config: { request: TEST_REQUEST, ...(config as object) },
  });

describe('azureOpenaiAdapter', () => {
  it('rejects a base URL that is not a URL, and an api-version that is not one', () => {
    expect(
      azureOpenaiAdapter.configSchema.safeParse({
        apiKey: 'k',
        baseUrl: 'not a url',
        deployment: 'd',
      }).success,
    ).toBe(false);
    expect(() =>
      azureOpenaiAdapter.configSchema.parse({
        apiKey: 'k',
        baseUrl: 'https://res.openai.azure.com/openai/v1',
        deployment: 'd',
        apiVersion: 'not-a-version-looks-like-a-key',
      }),
    ).toThrow('Expected v1, preview, or a date');
  });

  const cases = [
    {
      name: 'a v1 base URL',
      config: {
        apiKey: 'az-1',
        baseUrl: 'https://res.openai.azure.com/openai/v1/',
        deployment: 'my-deploy',
      },
      url: 'https://res.openai.azure.com/openai/v1/responses',
      model: 'my-deploy',
      key: 'az-1',
    },
    {
      name: 'an explicit apiVersion',
      config: {
        apiKey: 'az-2',
        baseUrl: 'https://res.cognitiveservices.azure.com/openai',
        deployment: 'gpt-6.1-sol',
        apiVersion: '2025-04-01-preview',
      },
      url: 'https://res.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview',
      model: 'gpt-6.1-sol',
      key: 'az-2',
    },
    {
      name: "the portal's Target URI pasted as-is",
      config: {
        apiKey: 'az-3',
        baseUrl:
          'https://res.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview',
        deployment: 'gpt-6.1-sol',
      },
      url: 'https://res.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview',
      model: 'gpt-6.1-sol',
      key: 'az-3',
    },
  ] as const;

  for (const { name, config, url, model, key } of cases) {
    it(`maps ${name} to ${url}`, async () => {
      const request = await sent(config);

      expect(request?.url).toBe(url);
      expect(request?.headers['api-key']).toBe(key);
      expect(request?.body.model).toBe(model);
    });
  }
});
