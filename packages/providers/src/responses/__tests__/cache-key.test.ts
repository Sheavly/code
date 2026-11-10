import { describe, expect, it } from 'vitest';
import { collect, fakeFetch } from '@sheavly/testing/fetch/fake-fetch.fake';
import { providerRequest } from '../../testing/provider-request.fake.js';
import { TEST_REQUEST } from '../../testing/request.constants.js';
import { createResponsesProvider } from '../responses.helper.js';

const sentKeys = async (cacheKeys: (string | undefined)[]) => {
  const { fetch, requests } = fakeFetch([{ type: 'response.output_text.delta', delta: 'ok' }]);
  const provider = createResponsesProvider({
    endpoint: { baseUrl: 'https://example.test/v1', model: 'm', headers: {} },
    request: TEST_REQUEST,
    fetch,
  });

  for (const cacheKey of cacheKeys) {
    await collect(provider.stream(providerRequest({ cacheKey })));
  }

  return requests.map((request) => request.body.prompt_cache_key);
};

describe('Responses prompt cache key', () => {
  it('sends the same key on every turn of a session and another for a different session', async () => {
    expect(await sentKeys(['session-a', 'session-a', 'session-b'])).toEqual([
      'session-a',
      'session-a',
      'session-b',
    ]);
  });

  it('leaves the field out when the request has no cache key', async () => {
    expect(await sentKeys([undefined])).toEqual([undefined]);
  });
});
