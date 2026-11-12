import { SEARCH_MAX_RETRY_AFTER_MS } from './keyless-search.constants.js';

/**
 * Reads a Retry-After header in delta-seconds as milliseconds, capped so a provider cannot
 * disable a backend for long. An HTTP date or any other value is undefined, so the caller falls
 * back to its default cooldown.
 */
export function parseRetryAfterMs(header: string | null) {
  const value = header?.trim();

  if (!value || !/^\d{1,9}$/.test(value)) return undefined;

  return Math.min(Number(value) * 1_000, SEARCH_MAX_RETRY_AFTER_MS);
}
