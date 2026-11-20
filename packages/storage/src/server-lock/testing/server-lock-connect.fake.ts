import { once } from 'node:events';
import net from 'node:net';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';

/** Test-only: what a connect to the socket at `file` gives: `connected`, or the error's code. */
export async function connectOutcome(file: string): Promise<string> {
  const socket = net.connect(file);

  try {
    await once(socket, 'connect');

    return 'connected';
  } catch (caughtError) {
    return errorCode(caughtError) ?? 'error';
  } finally {
    socket.destroy();
  }
}
