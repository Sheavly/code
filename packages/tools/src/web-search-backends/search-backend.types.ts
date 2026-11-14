import type { z } from 'zod';
import type { SearchResult } from '../web-search/web-search.types.js';
import type { searchBackendOptionsSchema } from './search-backend.validator.js';

/** Native fetch-compatible transport. Inject a fake in tests; an API key is supplied only by the app. */
export type SearchBackendOptions = z.input<typeof searchBackendOptionsSchema> & {
  fetch?: typeof globalThis.fetch;
};

/**
 * How one provider is called and read over HTTP. The shared builder adds what no backend may
 * choose: refused redirects, the abort signal, the byte cap and redacted failures.
 */
export type HttpSearchConfig = {
  /** Names the backend in errors; also its `SearchBackend.name`. */
  name: string;
  /** Content types a successful reply may have, lowercase and without parameters. */
  contentTypes: readonly string[];
  /** `apiKey` is set only when the app supplied one. */
  buildRequest: (params: { query: string; maxResults: number; apiKey: string | undefined }) => {
    url: string | URL;
    init: { method?: string; headers: Record<string, string>; body?: string };
  };
  /** Turns the reply body into results; throws WebSearchError when it is malformed. */
  parseBody: (text: string) => SearchResult[];
};
