import type { ServerErrorCode } from '@sheavly/protocol/server/server.types';

/**
 * The terminal can't get what it asked its backend for: the backend didn't start, exited, isn't
 * set up to connect to, or refused the request (`code` says why, from the server's error).
 */
export class BackendError extends Error {
  override name = 'BackendError';
  readonly code: ServerErrorCode | undefined;

  constructor(params: { message: string; code?: ServerErrorCode; cause?: unknown }) {
    const { message, code, cause } = params;

    super(message, cause === undefined ? undefined : { cause });
    this.code = code;
  }
}
