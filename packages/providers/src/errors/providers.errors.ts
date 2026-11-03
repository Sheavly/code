/**
 * Errors from the model backends. Providers don't depend on `@sheavly/runtime`, so they keep their own;
 * each has a `reason` a caller can switch on, and keeps the original as `cause`.
 */

/** An adapter can't be registered or built: a duplicate kind, an unknown kind, a bad config. */
export class AdapterError extends Error {
  override name = 'AdapterError';
  readonly reason: 'duplicate' | 'unknown' | 'invalid_config';
  /** The adapter kind asked for (`openai`, `azure`, ...). */
  readonly kind: string;

  constructor(params: {
    reason: 'duplicate' | 'unknown' | 'invalid_config';
    kind: string;
    message: string;
    cause?: unknown;
  }) {
    const { reason, kind, message, cause } = params;

    super(message, cause === undefined ? undefined : { cause });
    this.reason = reason;
    this.kind = kind;
  }
}

/** Why a Responses call failed. */
type ResponsesFailure =
  'http' | 'network' | 'timeout' | 'failed' | 'stream_error' | 'cut_off' | 'bad_payload';

/**
 * A Responses API call failed: an HTTP error (`status`), the request not reaching the server
 * (`network`) or no response in time (`timeout`), a `response.failed` or `error` event, a stream
 * that ended before `response.completed`, or a payload that isn't JSON.
 */
export class ResponsesApiError extends Error {
  override name = 'ResponsesApiError';
  readonly reason: ResponsesFailure;
  /** The HTTP status, for `http`. */
  readonly status: number | undefined;

  constructor(params: {
    reason: ResponsesFailure;
    message: string;
    status?: number;
    cause?: unknown;
  }) {
    const { reason, message, status, cause } = params;

    super(message, cause === undefined ? undefined : { cause });
    this.reason = reason;
    this.status = status;
  }
}

/** The provider switch can't serve: an unknown provider name, or none active yet. */
export class ProviderSwitchError extends Error {
  override name = 'ProviderSwitchError';
  readonly reason: 'unknown' | 'none_active';

  constructor(params: { reason: 'unknown' | 'none_active'; message: string }) {
    const { reason, message } = params;

    super(message);
    this.reason = reason;
  }
}
