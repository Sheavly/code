import { describe, expect, it } from 'vitest';
import { collect, fakeFetchSequence } from '@sheavly/testing/fetch/fake-fetch.fake';
import { azureChatAdapter } from '../chat.adapter.js';
import { azureOpenaiAdapter } from '../openai.adapter.js';
import { TEST_REQUEST } from '../../testing/request.constants.js';

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
      const fake = fakeFetchSequence({
        responses: [[{ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }]],
        complete: false,
      });
      const provider = azureChatAdapter.create({
        deps: { fetch: fake.fetch },
        config: azureChatAdapter.configSchema.parse({
          baseUrl,
          apiVersion,
          deployment: 'DeepSeek-V4-Flash',
          apiKey: 'private',
          request: TEST_REQUEST,
        }),
      });

      await collect(
        provider.stream({
          messages: [{ role: 'user', content: 'hello' }],
          tools: [],
          signal: new AbortController().signal,
        }),
      );
      expect(fake.requests[0]?.url).toBe(
        `https://resource.test/models/chat/completions?api-version=${expected}`,
      );
      expect(fake.requests[0]?.headers['api-key']).toBe('private');
      expect(fake.requests[0]?.body.model).toBe('DeepSeek-V4-Flash');
      expect(fake.requests[0]?.body.max_tokens).toBe(8192);
    },
  );

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
