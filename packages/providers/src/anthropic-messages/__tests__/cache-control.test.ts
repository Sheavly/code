import { describe, expect, it } from 'vitest';
import { collect, fakeFetchSequence } from '@sheavly/testing/fetch/fake-fetch.fake';
import { providerRequest } from '../../testing/provider-request.fake.js';
import { TEST_REQUEST } from '../../testing/request.constants.js';
import { createMessagesProvider } from '../messages.helper.js';

const STOP = { type: 'message_stop' };

const provider = (params: { fetch: typeof globalThis.fetch; promptCaching?: boolean }) =>
  createMessagesProvider({
    endpoint: { baseUrl: 'https://example.test/anthropic/v1', model: 'claude', headers: {} },
    maxTokens: 4096,
    promptCaching: params.promptCaching,
    request: TEST_REQUEST,
    fetch: params.fetch,
  });

describe('Messages prompt caching', () => {
  it('sends the top-level cache_control by default, on every call', async () => {
    const { fetch, requests } = fakeFetchSequence({ responses: [[STOP], [STOP]], complete: false });

    await collect(provider({ fetch }).stream(providerRequest()));
    await collect(provider({ fetch }).stream(providerRequest()));

    expect(requests.map((request) => request.body.cache_control)).toEqual([
      { type: 'ephemeral' },
      { type: 'ephemeral' },
    ]);
  });

  it('leaves the field out when the option turns it off', async () => {
    const { fetch, requests } = fakeFetchSequence({ responses: [[STOP]], complete: false });

    await collect(provider({ fetch, promptCaching: false }).stream(providerRequest()));

    expect(requests[0]?.body).not.toHaveProperty('cache_control');
  });

  it('sends it when the option is on explicitly', async () => {
    const { fetch, requests } = fakeFetchSequence({ responses: [[STOP]], complete: false });

    await collect(provider({ fetch, promptCaching: true }).stream(providerRequest()));

    expect(requests[0]?.body.cache_control).toEqual({ type: 'ephemeral' });
  });
});
