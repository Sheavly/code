// The project snapshots guard-shell-commands.mjs takes before a command runs, kept in the chat's
// state by the command's text until record-shell-writes.mjs reads them after it. A command that
// crashed, or was stopped before its after-hook ran, leaves its snapshot behind. It must not
// outlive that command: a later run of the same text, or a state that reads an old entry, would
// compare against files from long ago and blame the command for every change since. So a snapshot
// older than SNAPSHOT_TTL_MS is treated as absent, and dropped whenever the entries are rewritten.
// An after-hook that finds only an expired one can't tell what the command changed, so it records
// the chat's edits as incomplete and the stop gate runs unscoped (record-shell-writes.mjs).
import { hookNow } from './hooks.utils.mjs';

/** Longer than any command a hook waits on; a snapshot older than this belongs to a lost run. */
export const SNAPSHOT_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * The entries of `snapshots` (command text to snapshot) still within the TTL. One without a
 * `takenAt` comes from before snapshots were timed and is kept: it can't be aged.
 */
export function liveSnapshots(params) {
  const { snapshots, now = hookNow() } = params;

  return Object.fromEntries(
    Object.entries(snapshots ?? {}).filter(
      ([, snapshot]) =>
        typeof snapshot.takenAt !== 'number' || now - snapshot.takenAt <= SNAPSHOT_TTL_MS,
    ),
  );
}

/** The live entries of `snapshots` except the one of `command`. */
export function withoutSnapshot(params) {
  const { snapshots, command, now } = params;

  return Object.fromEntries(
    Object.entries(liveSnapshots({ snapshots, now })).filter(([key]) => key !== command),
  );
}

/** The snapshot taken before `command`, or undefined when there is none or it has expired. */
export function snapshotBefore(params) {
  const { snapshots, command, now } = params;

  return liveSnapshots({ snapshots, now })[command];
}
