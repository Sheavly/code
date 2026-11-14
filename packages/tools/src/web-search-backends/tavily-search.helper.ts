import { TAVILY_KEYLESS_HEADERS, TAVILY_SEARCH_URL } from './tavily-search.constants.js';
import { parseTavilyResponse } from './tavily-search.validator.js';
import { createHttpSearchBackend } from './search-backend.helper.js';
import type { SearchBackend } from '../web-search/web-search.types.js';
import type { TavilySearchOptions } from './tavily-search.types.js';

/** Uses Tavily's documented keyless access unless the app explicitly injects an API key. */
export function createTavilySearchBackend(options: TavilySearchOptions = {}): SearchBackend {
  return createHttpSearchBackend({
    config: {
      name: 'Tavily',
      contentTypes: ['application/json'],
      buildRequest: ({ query, maxResults, apiKey }) => ({
        url: TAVILY_SEARCH_URL,
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : TAVILY_KEYLESS_HEADERS),
          },
          body: JSON.stringify({
            query,
            max_results: maxResults,
            include_answer: false,
            include_raw_content: false,
          }),
        },
      }),
      parseBody: (text) =>
        parseTavilyResponse(text).results.map(({ title, url, content }) => ({
          title,
          url,
          snippet: content,
        })),
    },
    options,
  });
}
