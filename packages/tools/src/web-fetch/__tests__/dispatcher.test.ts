import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from 'undici';
import type * as Undici from 'undici';
import { publicDispatcher } from '../address.helper.js';
import { webFetchOptionsSchema } from '../web-fetch.validator.js';

vi.mock('undici', async (importOriginal) => {
  const original = await importOriginal<typeof Undici>();

  return {
    ...original,
    Agent: vi.fn(function (options?: Agent.Options) {
      return new original.Agent(options);
    }),
  };
});

beforeEach(() => vi.clearAllMocks());

describe('web_fetch DNS pinning', () => {
  it.each([
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ])('connects to the first checked $address without a second DNS lookup', async (first) => {
    const resolveAddresses = vi.fn().mockResolvedValue([first, { address: '1.1.1.1', family: 4 }]);
    const dispatcher = await publicDispatcher({
      url: new URL('https://example.com/'),
      policy: webFetchOptionsSchema.parse({}),
      resolveAddresses,
      signal: new AbortController().signal,
    });

    try {
      const connect = vi.mocked(Agent).mock.calls[0]?.[0]?.connect;

      if (!connect || typeof connect === 'function' || !('lookup' in connect) || !connect.lookup) {
        throw new Error('Expected a pinned DNS connector');
      }

      expect(connect).toMatchObject({ autoSelectFamily: false });
      const callback = vi.fn();

      connect.lookup('example.com', { family: 0 }, callback);

      expect(callback).toHaveBeenCalledWith(null, first.address, first.family);
      expect(resolveAddresses).toHaveBeenCalledExactlyOnceWith('example.com');
    } finally {
      await dispatcher.destroy();
    }
  });
});
