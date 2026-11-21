import type { ServerPresence } from '@sheavly/storage/discovery-file/server-presence.service';
import { STOP_SIGNALS } from './discovery.constants.js';
import type { SignalSource, StartupGuard } from './discovery.types.js';

/**
 * Handles SIGINT, SIGTERM and SIGHUP while the server is still starting: Node's default action
 * would end the process with the token's file and the lock left behind. A signal waits for the
 * tracked work, removes the file and releases the lock, then `exit`s with the usual code; a second
 * one exits at once. Install it before the first thing a start takes or writes.
 */
export function guardStartup(params: {
  source: SignalSource;
  exit: (code: number) => void;
  log: (text: string) => void;
}): StartupGuard {
  const { source, exit, log } = params;
  let pending: Promise<ServerPresence | undefined> = Promise.resolve(undefined);
  let leaving = false;

  async function leave(code: number): Promise<void> {
    if (leaving) {
      exit(code);

      return;
    }

    leaving = true;

    // A step that failed has nothing to clean up, and must not keep the process from exiting.
    const presence = await pending.catch((caughtError: unknown) => {
      log(`A startup step failed while stopping: ${String(caughtError)}\n`);

      return undefined;
    });

    // Out of the file first, so clients stop finding it; release never rejects.
    await presence?.remove();
    await presence?.release();
    exit(code);
  }

  const listeners = STOP_SIGNALS.map(({ signal, code }) => ({
    signal,
    listener: () => void leave(code),
  }));

  for (const { signal, listener } of listeners) source.on(signal, listener);

  return {
    track: (work) => {
      pending = work;
    },
    // Never settles once leaving: the start stops where it is while the guard cleans up and exits.
    proceed: () => (leaving ? new Promise<void>(() => undefined) : Promise.resolve()),
    uninstall: () => {
      for (const { signal, listener } of listeners) source.off(signal, listener);
    },
  };
}
