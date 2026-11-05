import type { ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

/**
 * Joins a child's standard streams to the rest of a pipeline, as a shell's pipes do. Standard
 * error always goes to `onChunk`; standard output goes to `stdoutTo` when there is one, else to
 * `onChunk` too. `input` feeds the child's standard input, which the child must have been started
 * with a pipe for. The child's output streams are always pipes.
 *
 * `onReaderGone` runs when `stdoutTo` is closed before the child finished writing: the process
 * reading it has exited (`head` after enough lines), so whoever writes to it is stopped, which a
 * shell does with SIGPIPE. Call `disconnect` once the child has exited, so what fed its input
 * stops too.
 */
export function connectStreams(params: {
  child: ChildProcess;
  input?: Readable | undefined;
  stdoutTo?: Writable | undefined;
  onChunk: (chunk: Buffer) => void;
  onReaderGone: () => void;
}): { disconnect: () => void } {
  const { child, input, stdoutTo, onChunk, onReaderGone } = params;

  child.stderr?.on('data', onChunk);

  if (stdoutTo) {
    child.stdout?.pipe(stdoutTo);
    stdoutTo.once('close', () => {
      if (!stdoutTo.writableFinished) onReaderGone();
    });
  } else {
    child.stdout?.on('data', onChunk);
  }

  if (input && child.stdin) {
    // A process that exits without reading all its input closes the pipe under the writer
    // (EPIPE); that is normal for `head`, not a failure of this run.
    child.stdin.on('error', () => undefined);
    input.pipe(child.stdin);
  }

  return {
    disconnect: () => {
      input?.destroy();
    },
  };
}
