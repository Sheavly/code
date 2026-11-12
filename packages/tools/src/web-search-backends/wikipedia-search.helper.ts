import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { WebSearchError } from '../errors/web-search.errors.js';
import { withAbort } from '../web-fetch/abort.helper.js';
import { WIKIPEDIA_SEARCH_URL, WIKIPEDIA_USER_AGENT } from './keyless-search.constants.js';
import { readSearchBody } from './search-response.helper.js';
import {
  keylessSearchOptionsSchema,
  keylessSearchRequestSchema,
  parseWikipediaResults,
} from './keyless-search.validator.js';
import type { SearchBackend } from '../web-search/web-search.types.js';
import type { KeylessSearchOptions } from './keyless-search.types.js';

/** Key-free, but only covers Wikipedia: meant as the last backend in a fallback chain. */
export function createWikipediaSearchBackend(options: KeylessSearchOptions = {}): SearchBackend {
  const { fetch = globalThis.fetch, ...rest } = options;
  const policy = parseOrThrow({
    schema: keylessSearchOptionsSchema,
    input: rest,
    onInvalid: ({ error }) =>
      new WebSearchError('Invalid Wikipedia search configuration', { cause: error }),
  });

  return {
    name: 'Wikipedia',
    async search({ query, maxResults, signal }) {
      const request = parseOrThrow({
        schema: keylessSearchRequestSchema,
        input: { query, maxResults },
        onInvalid: ({ error }) =>
          new WebSearchError('Invalid Wikipedia search request', { cause: error }),
      });
      const url = new URL(WIKIPEDIA_SEARCH_URL);

      url.search = new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: request.query,
        srlimit: String(request.maxResults),
        format: 'json',
      }).toString();

      try {
        signal.throwIfAborted();

        const response = await withAbort({
          operation: fetch(url, {
            redirect: 'error',
            headers: { Accept: 'application/json', 'User-Agent': WIKIPEDIA_USER_AGENT },
            signal,
          }),
          signal,
        });
        const text = await readSearchBody({
          name: 'Wikipedia',
          response,
          maxBytes: policy.maxBytes,
          signal,
          contentTypes: ['application/json'],
        });

        return parseWikipediaResults(text);
      } catch (caughtError) {
        if (caughtError instanceof WebSearchError) throw caughtError;

        throw new WebSearchError(
          signal.aborted ? 'Wikipedia search interrupted' : 'Wikipedia search request failed',
          { cause: caughtError },
        );
      }
    },
  };
}
