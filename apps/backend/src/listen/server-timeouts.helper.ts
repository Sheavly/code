import type { ServerType } from '@hono/node-server';
import { ServerAlreadyListeningError, UnsupportedServerError } from '../errors/listen.errors.js';
import {
  CONNECTIONS_CHECK_INTERVAL_MS,
  HEADERS_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
} from './listen.constants.js';

/**
 * Bounds how long a client may take to send a request: the whole request (`requestTimeout`) and its
 * headers (`headersTimeout`). Node closes a connection that exceeds either, so a slow or stalled
 * body holds a connection for seconds, not minutes. The limits apply to receiving the request;
 * a response that stays open (an event stream) is unaffected. Node only looks for expired
 * connections every `connectionsCheckingInterval`, so that is set too, or a limit would take up to
 * 30 s longer. Changes `server` in place and must run before it listens: throws
 * `ServerAlreadyListeningError` for one that already does, and `UnsupportedServerError` for a
 * server that has no such options.
 */
export function configureServerTimeouts(params: {
  server: ServerType;
  requestTimeoutMs?: number;
  headersTimeoutMs?: number;
  checkIntervalMs?: number;
}): void {
  const {
    server,
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
    headersTimeoutMs = HEADERS_TIMEOUT_MS,
    checkIntervalMs = CONNECTIONS_CHECK_INTERVAL_MS,
  } = params;

  if (!('requestTimeout' in server)) throw new UnsupportedServerError();

  // The check interval only takes effect when the check timer is created at `listen`.
  if (server.listening) throw new ServerAlreadyListeningError();

  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = headersTimeoutMs;
  // Node reads this property when the server starts listening; @types/node only types it as an
  // option of `createServer`.
  Object.assign(server, { connectionsCheckingInterval: checkIntervalMs });
}
