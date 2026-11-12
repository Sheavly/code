import { describe, expect, it } from 'vitest';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { WebSearchError, WebSearchRateLimitError } from '../../errors/web-search.errors.js';
import { createFallbackSearchBackend } from '../fallback-search.helper.js';
import type { SearchBackend } from '../../web-search/web-search.types.js';

const result = { title: 'T', url: 'https://example.com', snippet: 'S' };

function stub(name: string, behaviour: () => Promise<(typeof result)[]>) {
  const calls: AbortSignal[] = [];
  const backend: SearchBackend = {
    name,
    async search({ signal }) {
      calls.push(signal);

      return behaviour();
    },
  };

  return { backend, calls };
}

const ok = () => Promise.resolve([result]);
const rateLimited = (retryAfterMs?: number) => () =>
  Promise.reject(new WebSearchRateLimitError('limited', { retryAfterMs }));
const broken = () => Promise.reject(new WebSearchError('broken'));

function run(backend: SearchBackend, signal = new AbortController().signal) {
  return backend.search({ query: 'q', maxResults: 3, signal });
}

describe('fallback search backend', () => {
  const clock = useFixedClock();

  it('returns the first backend that succeeds and does not call later ones', async () => {
    const first = stub('A', ok);
    const second = stub('B', ok);
    const chain = createFallbackSearchBackend({ backends: [first.backend, second.backend] });

    await expect(run(chain)).resolves.toEqual([result]);
    expect(second.calls).toHaveLength(0);
  });

  it('falls back after an error or a rate limit', async () => {
    const chain = createFallbackSearchBackend({
      backends: [
        stub('A', broken).backend,
        stub('B', rateLimited()).backend,
        stub('C', ok).backend,
      ],
    });

    await expect(run(chain)).resolves.toEqual([result]);
  });

  it('falls back when a backend exceeds its own timeout, within the caller signal', async () => {
    const chain = createFallbackSearchBackend({
      backends: [
        {
          name: 'Slow',
          search: ({ signal }) =>
            new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(new WebSearchError('timed out')));
            }),
        },
        stub('B', ok).backend,
      ],
      backendTimeoutMs: 10,
    });

    await expect(run(chain)).resolves.toEqual([result]);
  });

  it('skips a rate-limited backend until its Retry-After passes', async () => {
    const limited = stub('A', rateLimited(5_000));
    const fallback = stub('B', ok);
    const chain = createFallbackSearchBackend({ backends: [limited.backend, fallback.backend] });

    await run(chain);
    await run(chain);
    expect(limited.calls).toHaveLength(1);

    clock.advance(5_001);
    await run(chain);
    expect(limited.calls).toHaveLength(2);
  });

  it('uses the default cooldown when no Retry-After was sent', async () => {
    const limited = stub('A', rateLimited());
    const chain = createFallbackSearchBackend({
      backends: [limited.backend, stub('B', ok).backend],
      defaultCooldownMs: 1_000,
    });

    await run(chain);
    clock.advance(999);
    await run(chain);
    expect(limited.calls).toHaveLength(1);

    clock.advance(2);
    await run(chain);
    expect(limited.calls).toHaveLength(2);
  });

  it('fails immediately naming no backend when every backend is cooling down', async () => {
    const only = stub('A', rateLimited(60_000));
    const chain = createFallbackSearchBackend({ backends: [only.backend] });

    await expect(run(chain)).rejects.toThrow('All search backends failed: A');
    await expect(run(chain)).rejects.toThrow('All 1 search backends are rate limited');
    expect(only.calls).toHaveLength(1);
  });

  it('names failed backends without their error details', async () => {
    const chain = createFallbackSearchBackend({
      backends: [
        stub('A', () => Promise.reject(new WebSearchError('secret-detail'))).backend,
        stub('B', broken).backend,
      ],
    });
    const failure = await run(chain).catch((caughtError: unknown) => caughtError);

    expect((failure as Error).message).toBe('All search backends failed: A, B');
  });

  it('stops the chain when the caller aborts instead of trying the next backend', async () => {
    const controller = new AbortController();
    const first = stub('A', () => {
      controller.abort();

      return Promise.reject(new WebSearchError('interrupted'));
    });
    const second = stub('B', ok);
    const chain = createFallbackSearchBackend({ backends: [first.backend, second.backend] });

    await expect(run(chain, controller.signal)).rejects.toThrow('interrupted');
    expect(second.calls).toHaveLength(0);
  });

  it('rejects an empty chain', () => {
    expect(() => createFallbackSearchBackend({ backends: [] })).toThrow('at least one backend');
  });
});
