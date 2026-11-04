/**
 * The terminal can't reach a backend: it didn't start, exited before it listened, or isn't set up
 * to connect to. A request a backend refused is `RefusedError`, from the client.
 */
export class BackendError extends Error {
  override name = 'BackendError';

  constructor(params: { message: string; cause?: unknown }) {
    const { message, cause } = params;

    super(message, cause === undefined ? undefined : { cause });
  }
}
