import { describe, expect, it } from 'vitest';
import { requestSentBy } from '@sheavly/testing/fetch/fake-fetch.fake';
import { openaiAdapter } from '../openai.adapter.js';
import { TEST_REQUEST } from '../../testing/request.constants.js';

const sent = (config: unknown) =>
  requestSentBy({
    adapter: openaiAdapter,
    config: { request: TEST_REQUEST, ...(config as object) },
  });

describe('openaiAdapter', () => {
  it('requires a model: the caller picks it', () => {
    expect(openaiAdapter.configSchema.safeParse({ apiKey: 'k' }).success).toBe(false);
  });

  it("calls OpenAI's Responses API with a Bearer key and reasoning on", async () => {
    const request = await sent({ apiKey: 'sk-1', model: 'gpt-6.1-sol' });

    expect(request?.url).toBe('https://api.openai.com/v1/responses');
    expect(request?.headers.authorization).toBe('Bearer sk-1');
    expect(request?.body.model).toBe('gpt-6.1-sol');
    expect(request?.body.include).toEqual(['reasoning.encrypted_content']);
  });

  it('uses a custom base URL without its trailing slashes', async () => {
    const request = await sent({ apiKey: 'k', model: 'm', baseUrl: 'https://proxy.test/v1//' });

    expect(request?.url).toBe('https://proxy.test/v1/responses');
  });
});
