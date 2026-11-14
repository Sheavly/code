import { WebSearchError, WebSearchRateLimitError } from '../errors/web-search.errors.js';
import { readBoundedBody } from '../web-fetch/body.helper.js';
import { withAbort } from '../web-fetch/abort.helper.js';
import { parseRetryAfterMs } from './retry-after.utils.js';

/**
 * Reads a successful search response as text, or throws a redacted failure for an HTTP error, an
 * unexpected content type or a body over `maxBytes`.
 */
export async function readSearchBody(params: {
  name: string;
  response: Response;
  maxBytes: number;
  signal: AbortSignal;
  contentTypes: readonly string[];
}) {
  const { name, response, maxBytes, signal, contentTypes } = params;

  if (!response.ok) {
    await response.body?.cancel();
    throw searchHttpFailure({ name, response });
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();

  if (!contentType || !contentTypes.includes(contentType)) {
    await response.body?.cancel();
    throw new WebSearchError(`${name} search returned an unexpected response type`);
  }

  // Read one extra byte so a complete body exactly at the cap is accepted, never a partial document.
  const { text, truncated } = await withAbort({
    operation: readBoundedBody({ response, maxBytes: maxBytes + 1, signal }),
    signal,
  });

  if (truncated) throw new WebSearchError(`${name} search response exceeded ${maxBytes} bytes`);

  return text;
}

/** 429, and Tavily's 432 (plan limit), are rate limits; 402 and Tavily's 433 are exhausted quota. */
const RATE_LIMITED = new Set([429, 432]);
const QUOTA_EXHAUSTED = new Set([402, 433]);

function searchHttpFailure(params: { name: string; response: Response }) {
  const { name, response } = params;
  const { status } = response;

  if (RATE_LIMITED.has(status)) {
    return new WebSearchRateLimitError(
      `${name} search rate limit exceeded (HTTP ${status}); retry later`,
      { retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')) },
    );
  }

  if (status === 401 || status === 403) {
    return new WebSearchError(
      `${name} search access denied (HTTP ${status}); check access mode or supplied API key`,
    );
  }

  if (QUOTA_EXHAUSTED.has(status)) {
    return new WebSearchError(
      `${name} search quota exhausted (HTTP ${status}); check the supplied account`,
    );
  }

  return new WebSearchError(`${name} search failed (HTTP ${status})`);
}
