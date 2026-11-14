import { WIKIPEDIA_SEARCH_URL, WIKIPEDIA_USER_AGENT } from './keyless-search.constants.js';
import { parseWikipediaResults } from './keyless-search.validator.js';
import { createHttpSearchBackend } from './search-backend.helper.js';
import type { SearchBackend } from '../web-search/web-search.types.js';
import type { SearchBackendOptions } from './search-backend.types.js';

/** Key-free, but only covers Wikipedia: meant as the last backend in a fallback chain. */
export function createWikipediaSearchBackend(options: SearchBackendOptions = {}): SearchBackend {
  return createHttpSearchBackend({
    config: {
      name: 'Wikipedia',
      contentTypes: ['application/json'],
      buildRequest: ({ query, maxResults }) => {
        const url = new URL(WIKIPEDIA_SEARCH_URL);

        url.search = new URLSearchParams({
          action: 'query',
          list: 'search',
          srsearch: query,
          srlimit: String(maxResults),
          format: 'json',
        }).toString();

        return {
          url,
          init: { headers: { Accept: 'application/json', 'User-Agent': WIKIPEDIA_USER_AGENT } },
        };
      },
      parseBody: parseWikipediaResults,
    },
    options,
  });
}
