import { now } from '@sheavly/core/clock/clock.helper';
import { SAME_KEYPRESS_MS } from '../render/render.constants.js';
import { describeFailure } from '../render/terminal-text.utils.js';
import type { CtrlCSource, StopResult } from './interrupt.types.js';

/**
 * The one Ctrl+C policy of the terminal's signal-driven entry points (demo, workbook, line chat):
 *
 * - A press within `SAME_KEYPRESS_MS` of the last one is the same keypress seen twice (as under
 *   `npx tsx`) and does nothing.
 * - A press that finds work running stops it (`stop`) and says a second one force-quits.
 * - A press that finds it already stopping force-quits: `forceQuit` runs first, whatever it
 *   fails with, and only then the process exits 130, so buffered writes are never lost.
 * - A press that finds nothing running calls `onIdle` (leave the chat), and later presses do
 *   nothing: it is leaving.
 *
 * Install it before the backend starts, so a press during startup stops that too (`stop` aborts
 * what `connectBackend` was given). `dispose` removes the listener.
 */
export function interruptOnCtrlC(params: {
  write: (text: string) => void;
  /** Stops the running work, or reports what it found. */
  stop: () => StopResult;
  /** Cleans up what this run started (conversation, backend, files) before the process exits. */
  forceQuit: () => Promise<void>;
  /** A press with nothing to stop; the demo and workbook have none, a chat leaves. */
  onIdle?: () => void;
  source?: CtrlCSource;
  exit?: (code: number) => void;
}): { dispose: () => void } {
  const { write, stop, forceQuit, onIdle, source = process } = params;
  const exit = params.exit ?? ((code: number) => process.exit(code));
  let pressedAt: number | undefined;
  let finished = false;
  const onSigint = () => {
    if (finished) return;
    if (pressedAt !== undefined && now() - pressedAt < SAME_KEYPRESS_MS) return;

    pressedAt = now();

    const stopped = stop();

    if (stopped === 'stopped') {
      write('\n⏹ Stopping… (Ctrl+C again to force quit)\n');

      return;
    }

    finished = true;

    if (stopped === 'idle') {
      onIdle?.();

      return;
    }

    write('\n✗ Forced exit.\n');
    void forceQuitThenExit({ forceQuit, write, exit });
  };

  source.on('SIGINT', onSigint);

  return { dispose: () => source.off('SIGINT', onSigint) };
}

/** `stop` for work that is one `AbortController`: the first press aborts it, later ones find it stopping. */
export function abortingStop(controller: AbortController): () => StopResult {
  return () => {
    if (controller.signal.aborted) return 'stopping';

    controller.abort();

    return 'stopped';
  };
}

/** Runs the cleanup, says if it failed, and exits 130 either way. */
async function forceQuitThenExit(params: {
  forceQuit: () => Promise<void>;
  write: (text: string) => void;
  exit: (code: number) => void;
}): Promise<void> {
  const { forceQuit, write, exit } = params;

  try {
    await forceQuit();
  } catch (caughtError) {
    write(`✗ Cleanup failed: ${describeFailure(caughtError)}\n`);
  } finally {
    exit(130);
  }
}
