import type { ReplayDrop } from '@sheavly/core/adapter/replay.types';
import { MAX_TOLD_DROPS } from './profiles.constants.js';

/**
 * A handler that tells `log` of each kind of dropped reasoning replay once. A model whose request
 * prefix changes every call (a transient notice moves it) drops its signed thinking on every
 * call, so one line per drop would bury the log in the same sentence. A kind is a reason and a
 * source, which is few; the handler keeps the ones it has told, up to `MAX_TOLD_DROPS`: a source
 * comes from stored history, so a long-lived backend must not grow without bound, and past the cap
 * the oldest is forgotten (and may be reported once more).
 */
export function createReplayDropLog(params: {
  log: (text: string) => void;
  /**
   * Tell of every drop, not each kind once. For `SHOW_MODEL_CALLS`, where each model call is
   * printed too, so a drop falls under the call that made it and a run's drops can be counted.
   */
  everyDrop?: boolean;
}): (drop: ReplayDrop) => void {
  const { log, everyDrop = false } = params;
  const told = new Set<string>();

  return ({ reason, source }) => {
    const from = source ? ` from ${source}` : '';

    if (everyDrop) {
      log(`Reasoning left out of a model call (${reason})${from}\n`);

      return;
    }

    const kind = `${reason}\n${source ?? ''}`;

    if (told.has(kind)) return;

    told.add(kind);

    const oldest = told.values().next();

    if (told.size > MAX_TOLD_DROPS && !oldest.done) told.delete(oldest.value);

    log(
      `Reasoning left out of a model call (${reason})${from}; the same drop is not reported again\n`,
    );
  };
}
