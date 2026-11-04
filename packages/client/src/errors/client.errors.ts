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
