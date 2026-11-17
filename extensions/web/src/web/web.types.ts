import type { WebFetchOptions } from '@sheavly/tools/web-fetch/web-fetch.types';
import type { WebSearchOptions } from '@sheavly/tools/web-search/web-search.types';

/**
 * What the run decides about web access. `false` leaves a tool out for the main run and every
 * sub-agent; search has no default backend, so the app picks one (`@sheavly/tools`'s
 * `web-search-backends/`) and passes it in.
 */
export type WebExtensionOptions = {
  webFetch: false | WebFetchOptions;
  webSearch: false | WebSearchOptions;
};
