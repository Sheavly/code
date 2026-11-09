/**
 * The terminal can't reach a backend, or a streamed main-session run failed. A request a backend
 * refused is `RefusedError`, from the client.
 */
export class BackendError extends Error {
  override name = 'BackendError';

  constructor(params: { message: string; cause?: unknown }) {
    const { message, cause } = params;

    super(message, cause === undefined ? undefined : { cause });
  }
}
