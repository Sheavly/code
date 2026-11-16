import type { ReplayDrop } from '@sheavly/core/adapter/replay.types';

/**
 * A handler that tells `log` of each kind of dropped reasoning replay once. A model whose request
 * prefix changes every call (a transient notice moves it) drops its signed thinking on every
 * call, so one line per drop would bury the log in the same sentence. A kind is a reason and a
 * source, which is few; the handler keeps the ones it has told.
 */
export function createReplayDropLog(log: (text: string) => void): (drop: ReplayDrop) => void {
  const told = new Set<string>();

  return ({ reason, source }) => {
    const kind = `${reason}\n${source ?? ''}`;

    if (told.has(kind)) return;

    told.add(kind);
    log(
      `Reasoning left out of a model call (${reason})${source ? ` from ${source}` : ''}; the same drop is not reported again\n`,
    );
  };
}
