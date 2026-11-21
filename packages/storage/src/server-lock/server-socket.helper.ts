import net from 'node:net';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';
import type { ListenOutcome, ProbeResult } from './server-lock.types.js';
import { probeResultOfError } from './server-lock.utils.js';

/**
 * Listens on `path`. The server only closes every connection it is given: it exists to be found
 * by a probe, and it is not `unref`'d, so it keeps its process alive like the server it guards.
 */
export function listenOnce(path: string): Promise<ListenOutcome> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.destroy();
    });

    server.once('error', (caughtError: unknown) => {
      resolve({ status: 'failed', code: errorCode(caughtError), error: caughtError });
    });
    server.listen(path, () => {
      // A later error must not become an uncaught exception that kills the server's process.
      server.on('error', () => undefined);
      resolve({ status: 'listening', server });
    });
  });
}

/**
 * Connects to the socket at `path`: a connection is `live`; a refused or vanished socket is
 * `stale`; any other error, or no answer within `timeoutMs`, is `unknown`.
 */
export function probeSocket(params: { path: string; timeoutMs: number }): Promise<ProbeResult> {
  const { path, timeoutMs } = params;

  return new Promise((resolve) => {
    const socket = net.connect(path);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve('unknown');
    }, timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve('live');
    });
    socket.once('error', (caughtError: unknown) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(probeResultOfError(errorCode(caughtError)));
    });
  });
}
