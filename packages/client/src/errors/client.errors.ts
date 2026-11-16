import type { ServerErrorCode } from '@sheavly/protocol/server/server.types';

/**
 * A backend refused a client's request: `code` is the protocol's reason (`not_found`,
 * `unknown_model`, …) when its body said one, for a UI to branch on; `status` the HTTP status.
 */
export class RefusedError extends Error {
  override name = 'RefusedError';
  readonly status: number;
  readonly code: ServerErrorCode | undefined;

  constructor(params: { status: number; code?: ServerErrorCode | undefined; message: string }) {
    const { status, code, message } = params;

    super(message);
    this.status = status;
    this.code = code;
  }
}

/** A stream that should never end ended: the backend or a proxy cut it. The cause of a reconnect. */
export class StreamEndedError extends Error {
  override name = 'StreamEndedError';
  readonly lastEventId: number | undefined;

  constructor(params: { lastEventId: number | undefined }) {
    super('The stream ended, and it should not end');
    this.lastEventId = params.lastEventId;
  }
}

/**
 * A stream dropped and the client gave up reconnecting: `lastEventId` is the last entry it got
 * (none when it never got one), so a UI can show the gap or resume later with that id, and
 * `attempts` how many times it tried in a row. The reason it stopped is the `cause`.
 */
export class StreamLostError extends Error {
  override name = 'StreamLostError';
  readonly lastEventId: number | undefined;
  readonly attempts: number;

  constructor(params: { lastEventId: number | undefined; attempts: number; cause: unknown }) {
    const { lastEventId, attempts, cause } = params;

    const why = cause instanceof Error ? cause.message : String(cause);

    super(`Lost the stream after ${String(attempts)} reconnect attempts: ${why}`, { cause });
    this.lastEventId = lastEventId;
    this.attempts = attempts;
  }
}

/**
 * A backend's answer didn't match the contract: the route's schema refused it. A client and
 * backend that drifted apart fail here, loudly, instead of passing on data no type describes.
 */
export class AnswerError extends Error {
  override name = 'AnswerError';

  constructor(params: { route: string; cause: unknown }) {
    const { route, cause } = params;

    super(`The backend's answer to ${route} doesn't match the contract`, { cause });
  }
}
