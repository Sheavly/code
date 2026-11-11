import { WebSearchError } from '../errors/web-search.errors.js';
import { withAbort } from '../web-fetch/abort.helper.js';
import { parseSearchResults } from './web-search.validator.js';
import { boundSearchResults } from './web-search.utils.js';
import type { SearchBackend, WebSearchPolicy } from './web-search.types.js';

export async function executeSearch(params: {
  backend: SearchBackend;
  query: string;
  policy: WebSearchPolicy;
  signal: AbortSignal;
}) {
  const { backend, query, policy, signal } = params;
  const timeout = new AbortController();
  const combined = AbortSignal.any([signal, timeout.signal]);
  const timer = setTimeout(() => timeout.abort(), policy.timeoutMs);

  try {
    if (combined.aborted) throw new WebSearchError(`${backend.name} search interrupted`);

    const input = await withAbort({
      operation: backend.search({ query, maxResults: policy.maxResults, signal: combined }),
      signal: combined,
    });
    const results = parseSearchResults({ input, backendName: backend.name });

    return boundSearchResults({ results, policy });
  } catch (caughtError) {
    if (timeout.signal.aborted && !signal.aborted) {
      throw new WebSearchError(`${backend.name} search timed out after ${policy.timeoutMs}ms`, {
        cause: caughtError,
      });
    }

    if (signal.aborted) {
      throw new WebSearchError(`${backend.name} search interrupted`, { cause: caughtError });
    }

    if (caughtError instanceof WebSearchError) throw caughtError;

    // Backend and transport exception messages may include request headers or response bodies.
    throw new WebSearchError(`${backend.name} search failed`, { cause: caughtError });
  } finally {
    clearTimeout(timer);
  }
}
