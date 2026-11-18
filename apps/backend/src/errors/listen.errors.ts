/**
 * The backend found no free port to listen on: the OS had none and every fallback port was taken
 * too. `cause` is the last listen error.
 */
export class NoFreePortError extends Error {
  override name = 'NoFreePortError';

  constructor(params: { message: string; cause: unknown }) {
    const { message, cause } = params;

    super(message, { cause });
  }
}
