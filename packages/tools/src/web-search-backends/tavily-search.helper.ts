import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { WebSearchError, WebSearchRateLimitError } from '../errors/web-search.errors.js';
import { parseRetryAfterMs } from './retry-after.utils.js';
import { readBoundedBody } from '../web-fetch/body.helper.js';
import { TAVILY_KEYLESS_HEADERS, TAVILY_SEARCH_URL } from './tavily-search.constants.js';
import { withAbort } from '../web-fetch/abort.helper.js';
import {
  tavilySearchRequestSchema,
  parseTavilyResponse,
  tavilySearchOptionsSchema,
} from './tavily-search.validator.js';
import type { SearchBackend } from '../web-search/web-search.types.js';
import type { TavilySearchOptions } from './tavily-search.types.js';

/** Uses Tavily's documented keyless access unless the app explicitly injects an API key. */
export function createTavilySearchBackend(options: TavilySearchOptions = {}): SearchBackend {
  const { fetch = globalThis.fetch, ...config } = options;
  const policy = parseOrThrow({
    schema: tavilySearchOptionsSchema,
    input: config,
    onInvalid: ({ error }) =>
      new WebSearchError('Invalid Tavily search configuration', { cause: error }),
  });

  return {
    name: 'Tavily',
    async search({ query, maxResults, signal }) {
      const request = parseOrThrow({
        schema: tavilySearchRequestSchema,
        input: { query, maxResults },
        onInvalid: ({ error }) =>
          new WebSearchError('Invalid Tavily search request', { cause: error }),
      });

      try {
        signal.throwIfAborted();

        const response = await withAbort({
          operation: fetch(TAVILY_SEARCH_URL, {
            method: 'POST',
            redirect: 'error',
            headers: {
              'Content-Type': 'application/json',
              ...(policy.apiKey
                ? { Authorization: `Bearer ${policy.apiKey}` }
                : TAVILY_KEYLESS_HEADERS),
            },
            body: JSON.stringify({
              query: request.query,
              max_results: request.maxResults,
              include_answer: false,
              include_raw_content: false,
            }),
            signal,
          }),
          signal,
        });

        return await readTavilyResults({ response, maxBytes: policy.maxBytes, signal });
      } catch (caughtError) {
        if (caughtError instanceof WebSearchError) throw caughtError;

        // Fetch errors can contain credentials; only deliberately constructed messages cross the boundary.
        throw new WebSearchError(
          signal.aborted ? 'Tavily search interrupted' : 'Tavily search request failed',
          { cause: caughtError },
        );
      }
    },
  };
}

async function readTavilyResults(params: {
  response: Response;
  maxBytes: number;
  signal: AbortSignal;
}) {
  const { response, maxBytes, signal } = params;

  if (!response.ok) {
    await response.body?.cancel();

    if (response.status === 429 || response.status === 432) {
      throw new WebSearchRateLimitError(tavilyHttpFailure(response.status), {
        retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
      });
    }

    throw new WebSearchError(tavilyHttpFailure(response.status));
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();

  if (contentType !== 'application/json') {
    await response.body?.cancel();
    throw new WebSearchError('Tavily search returned a non-JSON response');
  }

  // Read one extra byte so a complete body exactly at the cap is accepted, never a partial JSON document.
  const { text, truncated } = await withAbort({
    operation: readBoundedBody({ response, maxBytes: maxBytes + 1, signal }),
    signal,
  });

  if (truncated) throw new WebSearchError(`Tavily search response exceeded ${maxBytes} bytes`);

  const parsed = parseTavilyResponse(text);

  return parsed.results.map(({ title, url, content }) => ({ title, url, snippet: content }));
}

function tavilyHttpFailure(status: number) {
  if (status === 401 || status === 403) {
    return `Tavily search access denied (HTTP ${status}); check access mode or supplied API key`;
  }

  if (status === 429 || status === 432) {
    return `Tavily search rate limit exceeded (HTTP ${status}); retry later`;
  }

  if (status === 402 || status === 433) {
    return `Tavily search quota exhausted (HTTP ${status}); check the supplied account`;
  }

  return `Tavily search failed (HTTP ${status})`;
}
