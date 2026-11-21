import type { ServerType } from '@hono/node-server';
import { NoFreePortError } from '../errors/listen.errors.js';
import {
  ADDRESS_IN_USE,
  FALLBACK_PORT_ATTEMPTS,
  FALLBACK_PORT_MAX,
  FALLBACK_PORT_MIN,
} from './listen.constants.js';

type ListenParams = {
  server: ServerType;
  host: string;
  port: number;
  /**
   * Whether a taken `port` may move to a free one, as port 0 does. Set it for a default port the
   * user did not choose; an explicit port stays strict.
   */
  fallback?: boolean;
  /** Source of numbers in [0, 1) for the fallback ports; tests pass a fixed one. */
  random?: () => number;
};

function isAddressInUse(caughtError: unknown): boolean {
  return (
    caughtError instanceof Error && 'code' in caughtError && caughtError.code === ADDRESS_IN_USE
  );
}

function randomFallbackPort(random: () => number): number {
  return FALLBACK_PORT_MIN + Math.floor(random() * (FALLBACK_PORT_MAX - FALLBACK_PORT_MIN + 1));
}

/**
 * Makes `server` listen. A fixed port is tried once and its error rejected unchanged, so a user who
 * asked for a port is told it is taken, unless `fallback` is set. Port 0, or a taken port with
 * `fallback`, asks the OS for a free port; when that fails with EADDRINUSE (the OS has none, or a
 * bind race) it tries up to `FALLBACK_PORT_ATTEMPTS` random ports in the fallback range, and
 * rejects with `NoFreePortError` when all are taken. Any other error is rejected unchanged at once.
 */
export async function listenServer(params: ListenParams): Promise<void> {
  const { server, host, port, fallback = false, random = Math.random } = params;

  try {
    await listenOnce({ server, host, port });

    return;
  } catch (caughtError) {
    // Only a taken or exhausted port has a fallback; a strict port or another error is the caller's.
    if ((port !== 0 && !fallback) || !isAddressInUse(caughtError)) throw caughtError;

    await listenOnFallbackPort({
      server,
      host,
      random,
      firstError: caughtError,
      askOs: port !== 0,
    });
  }
}

async function listenOnFallbackPort(params: {
  server: ServerType;
  host: string;
  random: () => number;
  firstError: unknown;
  /** Whether the OS has not been asked yet: the first listen was on a named port, not port 0. */
  askOs: boolean;
}): Promise<void> {
  const { server, host, random, firstError, askOs } = params;
  let lastError = firstError;

  if (askOs) {
    try {
      await listenOnce({ server, host, port: 0 });

      return;
    } catch (caughtError) {
      if (!isAddressInUse(caughtError)) throw caughtError;

      lastError = caughtError;
    }
  }

  for (let attempt = 0; attempt < FALLBACK_PORT_ATTEMPTS; attempt++) {
    try {
      await listenOnce({ server, host, port: randomFallbackPort(random) });

      return;
    } catch (caughtError) {
      if (!isAddressInUse(caughtError)) throw caughtError;

      lastError = caughtError;
    }
  }

  throw new NoFreePortError({
    // The first error was EADDRINUSE, or this fallback would not run.
    message: `No free port could be found on ${host}: the OS gave none (${ADDRESS_IN_USE}) and ${String(FALLBACK_PORT_ATTEMPTS)} fallback ports in ${String(FALLBACK_PORT_MIN)}-${String(FALLBACK_PORT_MAX)} were taken.`,
    cause: lastError,
  });
}

async function listenOnce(params: {
  server: ServerType;
  host: string;
  port: number;
}): Promise<void> {
  const { server, host, port } = params;
  const { promise, resolve, reject } = Promise.withResolvers<undefined>();
  const onListening = () => resolve(undefined);

  server.once('error', reject);
  server.once('listening', onListening);

  try {
    server.listen({ host, port });
    await promise;
  } finally {
    server.removeListener('error', reject);
    server.removeListener('listening', onListening);
  }
}
