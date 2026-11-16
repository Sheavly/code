import type { ChildProcess } from 'node:child_process';
import { BackendError } from '../errors/backend.errors.js';
import { GROUP_POLL_MS, GROUP_REAP_MS } from './client.constants.js';

/**
 * Sends `signal` to the whole process group of a child started `detached` (`0` only asks whether
 * the group still exists). Returns false when the group is already gone (`ESRCH`): the child ended
 * between our check and the signal, which is what stopping it wanted anyway, and for a pid that
 * cannot lead a child's group (`0` and `1` would reach the caller's own group or every process).
 * Any other failure throws.
 */
export function signalProcessGroup(params: { pid: number; signal: NodeJS.Signals | 0 }): boolean {
  const { pid, signal } = params;

  if (!Number.isInteger(pid) || pid <= 1) return false;

  try {
    process.kill(-pid, signal);

    return true;
  } catch (caughtError) {
    if ((caughtError as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw caughtError;
  }
}

/**
 * Stops a detached child and the group it leads: SIGTERM first so every member can close what it
 * started, then SIGKILL to the group when any member is left after `timeoutMs`, even if the leader
 * has gone. Resolves once the group is gone; a child that already ended, or whose group is already
 * gone, resolves at once. Rejects with a signalling failure other than "no such group".
 *
 * A leader that has already exited is left alone, since once its group is empty its pid may belong
 * to a stranger. `afterLeaderExit` is for the one caller that knows the leader ended moments ago
 * (a start that failed because it exited): members it left behind are still stopped.
 */
export function stopProcessGroup(params: {
  child: ChildProcess;
  timeoutMs: number;
  afterLeaderExit?: boolean;
}): Promise<void> {
  const { child, timeoutMs, afterLeaderExit = false } = params;
  const { pid } = child;
  const exited = child.exitCode !== null || child.signalCode !== null;

  if (pid === undefined || (exited && !afterLeaderExit)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timers: { deadline?: NodeJS.Timeout; watch?: NodeJS.Timeout } = {};
    let settled = false;
    const settle = (error?: Error) => {
      settled = true;
      clearTimeout(timers.deadline);
      clearInterval(timers.watch);
      if (error === undefined) resolve();
      else reject(error);
    };
    // A signalling failure inside a timer or an event would otherwise be an uncaught exception.
    const guarded = (step: () => void) => () => {
      try {
        step();
      } catch (caughtError) {
        settle(
          caughtError instanceof Error
            ? caughtError
            : new BackendError({ message: 'Could not signal the backend', cause: caughtError }),
        );
      }
    };
    const checkGone = guarded(() => {
      if (!signalProcessGroup({ pid, signal: 0 })) settle();
    });

    timers.deadline = setTimeout(
      guarded(() => {
        if (!signalProcessGroup({ pid, signal: 'SIGKILL' })) {
          settle();

          return;
        }

        // SIGKILL cannot be ignored, but a killed member is a group member until it is reaped:
        // the group is polled until it is gone, and never waited for beyond `GROUP_REAP_MS`.
        timers.deadline = setTimeout(guarded(settle), GROUP_REAP_MS);
      }),
      timeoutMs,
    );
    const watchGroup = guarded(() => {
      checkGone();
      // The leader is gone, but members that were told to stop may still be closing.
      if (!settled) timers.watch = setInterval(checkGone, GROUP_POLL_MS);
    });

    guarded(() => {
      if (!signalProcessGroup({ pid, signal: 'SIGTERM' })) settle();
    })();

    if (settled) return;
    if (exited) watchGroup();
    else child.once('exit', watchGroup);
  });
}
