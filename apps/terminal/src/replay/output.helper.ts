import type { Writable } from 'node:stream';
import { ReplayOutputError } from '../errors/replay.errors.js';
import type { ReplayOutput } from './replay.types.js';

/** Whether `caughtError` is the reader of a pipe having gone away. */
function isBrokenPipe(caughtError: unknown): boolean {
  return caughtError instanceof Error && 'code' in caughtError && caughtError.code === 'EPIPE';
}

/**
 * A `Write` onto `output` that stops quietly when the reader goes away (`replay … | head`), as a
 * pipe's reader leaving is not a failure of the replay. Any other error of `output` (a full disk)
 * also stops the writing, and is kept for `failure` to return, so the caller reports it the way it
 * reports every failure: thrown from an event handler it would be an uncaught exception instead.
 * Writes are not awaited: a replay is bounded by its file. `failure` waits for what was written to
 * reach the output first, since a write's error is only reported then (`> /dev/full` fails late).
 */
export function writeUntilReaderLeaves(output: Writable): ReplayOutput {
  let stopped = false;
  let failure: ReplayOutputError | undefined;

  output.on('error', (caughtError: unknown) => {
    stopped = true;
    if (isBrokenPipe(caughtError)) return;
    failure ??= new ReplayOutputError(caughtError);
  });

  return {
    write: (text) => {
      if (!stopped) void output.write(text);
    },
    // The error event follows the write's callback, so the check waits one more turn.
    failure: () =>
      new Promise((resolve) => {
        output.write('', () => setImmediate(() => resolve(failure)));
      }),
  };
}
