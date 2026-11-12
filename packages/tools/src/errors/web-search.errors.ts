/** Messages are safe for model-facing tool errors; raw transport failures belong only in cause. */
export class WebSearchError extends Error {
  override readonly name = 'WebSearchError';
}

/** A provider refused for rate limiting; `retryAfterMs` is its Retry-After hint, when it sent a valid one. */
export class WebSearchRateLimitError extends WebSearchError {
  readonly retryAfterMs: number | undefined;

  constructor(message: string, options: ErrorOptions & { retryAfterMs?: number | undefined } = {}) {
    super(message, options);
    this.retryAfterMs = options.retryAfterMs;
  }
}
