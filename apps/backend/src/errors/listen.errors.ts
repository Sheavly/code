/** A server with no request or headers timeout (an HTTP/2 one) was given where the backend sets them. */
export class UnsupportedServerError extends Error {
  override name = 'UnsupportedServerError';

  constructor() {
    super(
      'The server has no requestTimeout and headersTimeout: only an HTTP/1 server is supported',
    );
  }
}

/**
 * The server's timeouts were configured after it began listening. Node reads the interval at which
 * it checks for expired connections only when it starts listening, so a later change would leave a
 * stalled request open for far longer than its limit.
 */
export class ServerAlreadyListeningError extends Error {
  override name = 'ServerAlreadyListeningError';

  constructor() {
    super('The server is already listening: configure its timeouts before it listens');
  }
}

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
