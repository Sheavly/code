import {
  EXA_SEARCH_URL,
  FIRECRAWL_SEARCH_URL,
  PARALLEL_SEARCH_URL,
  TINYFISH_KEYLESS_HEADERS,
  TINYFISH_SEARCH_URL,
} from './keyless-search.constants.js';
import {
  parseExaResults,
  parseFirecrawlResults,
  parseParallelResults,
  parseTinyFishResults,
} from './keyless-search.validator.js';
import { createJsonRpcSearchBackend } from './json-rpc-search.helper.js';
import type { SearchBackendOptions } from './search-backend.types.js';

const bearer = (apiKey: string | undefined): Record<string, string> =>
  apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

/** Keyless unless the app injects an API key; an injected key replaces the keyless access header. */
export function createTinyFishSearchBackend(options?: SearchBackendOptions) {
  return createJsonRpcSearchBackend({
    config: {
      name: 'TinyFish',
      url: TINYFISH_SEARCH_URL,
      tool: 'search',
      buildArguments: ({ query }) => ({ query }),
      accessHeaders: (apiKey) => (apiKey ? { 'X-API-Key': apiKey } : TINYFISH_KEYLESS_HEADERS),
      parseResults: parseTinyFishResults,
    },
    options,
  });
}

/** Exa answers keyless with no access header; an injected key goes in `x-api-key`. */
export function createExaSearchBackend(options?: SearchBackendOptions) {
  return createJsonRpcSearchBackend({
    config: {
      name: 'Exa',
      url: EXA_SEARCH_URL,
      tool: 'web_search_exa',
      buildArguments: ({ query, maxResults }) => ({ query, numResults: maxResults }),
      accessHeaders: (apiKey) => (apiKey ? { 'x-api-key': apiKey } : {}),
      parseResults: parseExaResults,
    },
    options,
  });
}

/** Parallel answers keyless with no access header; an injected key is sent as a Bearer token. */
export function createParallelSearchBackend(options?: SearchBackendOptions) {
  return createJsonRpcSearchBackend({
    config: {
      name: 'Parallel',
      url: PARALLEL_SEARCH_URL,
      tool: 'web_search',
      buildArguments: ({ query }) => ({ objective: query, search_queries: [query] }),
      accessHeaders: bearer,
      parseResults: parseParallelResults,
    },
    options,
  });
}

/** Firecrawl answers keyless with no access header; descriptions are large, so `maxBytes` matters. */
export function createFirecrawlSearchBackend(options?: SearchBackendOptions) {
  return createJsonRpcSearchBackend({
    config: {
      name: 'Firecrawl',
      url: FIRECRAWL_SEARCH_URL,
      tool: 'firecrawl_search',
      buildArguments: ({ query, maxResults }) => ({ query, limit: maxResults }),
      accessHeaders: bearer,
      parseResults: parseFirecrawlResults,
    },
    options,
  });
}
