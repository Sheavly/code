import { now } from '@sheavly/core/clock/clock.helper';
import { WebSearchError, WebSearchRateLimitError } from '../errors/web-search.errors.js';
import {
  FALLBACK_BACKEND_NAME,
  FALLBACK_DEFAULT_BACKEND_TIMEOUT_MS,
  FALLBACK_DEFAULT_COOLDOWN_MS,
} from './fallback-search.constants.js';
import type { SearchBackend } from '../web-search/web-search.types.js';
import type { FallbackSearchOptions } from './fallback-search.types.js';

/**
 * Tries each backend in order and moves on when one fails, times out or is rate limited. A rate
 * limited backend is skipped until its Retry-After (or the default cooldown) passes; cooldowns
 * live in this instance. A caller abort stops the whole chain instead of trying the next backend.
 * Throws when `backends` is empty.
 *
 * Each backend is in one of two states, kept in `coolingUntil` (an entry means cooling):
 *
 * | State       | Moves to    | When                                                  |
 * | ----------- | ----------- | ----------------------------------------------------- |
 * | `available` | `cooling`   | its search throws a `WebSearchRateLimitError`         |
 * | `available` | `available` | it succeeds, times out or fails for another reason    |
 * | `cooling`   | `available` | the clock passes its `until` (read on the next search) |
 * | `cooling`   | `cooling`   | a search skips it; a new rate limit replaces `until`  |
 *
 * A caller abort changes no state.
 */
export function createFallbackSearchBackend(options: FallbackSearchOptions): SearchBackend {
  const {
    backends,
    backendTimeoutMs = FALLBACK_DEFAULT_BACKEND_TIMEOUT_MS,
    defaultCooldownMs = FALLBACK_DEFAULT_COOLDOWN_MS,
  } = options;

  if (backends.length === 0) {
    throw new WebSearchError('Fallback search needs at least one backend');
  }

  const coolingUntil = new Map<SearchBackend, number>();

  return {
    name: FALLBACK_BACKEND_NAME,
    async search({ query, maxResults, signal }) {
      const failed: string[] = [];

      for (const backend of backends) {
        if ((coolingUntil.get(backend) ?? 0) > now()) continue;

        try {
          return await backend.search({
            query,
            maxResults,
            signal: AbortSignal.any([signal, AbortSignal.timeout(backendTimeoutMs)]),
          });
        } catch (caughtError) {
          // Only the caller's abort ends the chain; a backend's own timeout is a failure to skip.
          if (signal.aborted) throw caughtError;

          failed.push(backend.name);

          if (caughtError instanceof WebSearchRateLimitError) {
            coolingUntil.set(backend, now() + (caughtError.retryAfterMs ?? defaultCooldownMs));
          }
        }
      }

      throw new WebSearchError(searchChainFailure({ failed, total: backends.length }));
    },
  };
}

function searchChainFailure(params: { failed: string[]; total: number }) {
  const { failed, total } = params;

  if (failed.length === 0) return `All ${total} search backends are rate limited; retry later`;

  return `All search backends failed: ${failed.join(', ')}`;
}
