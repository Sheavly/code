import { changesText } from '../changes/changes-text.utils.js';
import { failuresText } from '../failures/failures-text.utils.js';
import type { Describer } from './chat.types.js';

/** What `/changes <target>` says: the files changed in this chat, or the diffs `target` names. */
export function describeChanges(params: { from: Describer; target?: string | undefined }): string {
  const { from, target } = params;

  return changesText({
    edits: from.renderer.changes.edits,
    target,
    columns: from.columns(),
    palette: from.palette,
    linkFile: from.linkFile,
  });
}

/** What `/errors <target>` says: the failed steps with more to say, or the one `target` names. */
export function describeFailures(params: { from: Describer; target?: string | undefined }): string {
  const { from, target } = params;

  return failuresText({
    failures: from.renderer.failures.failures,
    target,
    palette: from.palette,
  });
}

/**
 * The newest collapsed line's whole text, for a key that expands it: a failure's message or a
 * file change's diff, whichever was printed last; says so when there is neither.
 */
export function describeLatest(from: Describer): string {
  const failure = from.renderer.failures.failures.at(-1);

  if (failure && from.renderer.latestExpandable === 'failure') {
    return describeFailures({ from, target: String(failure.number) });
  }

  const change = from.renderer.changes.edits.at(-1);

  return describeChanges({ from, target: change && String(change.number) });
}
