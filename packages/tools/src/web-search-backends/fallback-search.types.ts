import type { SearchBackend } from '../web-search/web-search.types.js';

export type FallbackSearchOptions = {
  /** Tried in order; the first to succeed wins. Must not be empty. */
  backends: SearchBackend[];
  /** Cap for one backend, so a slow one cannot use the whole call budget. */
  backendTimeoutMs?: number;
  /** How long a rate-limited backend is skipped when it sent no valid Retry-After. */
  defaultCooldownMs?: number;
};
