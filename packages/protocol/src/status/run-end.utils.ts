import { isMainSession } from '../session/session.utils.js';
import type { RunOutcome } from '../session/session.types.js';
import type { StreamEntry } from '../stream/stream.types.js';

/**
 * How the main session's run ended, if `entry` is where it ends, else undefined. A run ends with
 * the main session's `done`, whichever way it ended: a failed run emits `done` with reason
 * `failed` after `run_failed`. Every reader of a stream asks this instead of matching entries
 * itself: the backend to close a prompt's response, the clients to report the outcome.
 */
export function runEnd(entry: StreamEntry): RunOutcome | undefined {
  if (entry.kind !== 'event' || entry.event.type !== 'done') return undefined;
  if (!isMainSession(entry.event.session)) return undefined;

  return entry.event.reason;
}
