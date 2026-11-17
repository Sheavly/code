import { runEnd } from '@sheavly/protocol/status/run-end.utils';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type {
  ReplaySummary,
  SeqGap,
  SessionSummary,
  StoredStream,
  TaskSummary,
} from './replay.types.js';

/** The `<kind>:<type>` an entry is counted under, e.g. `event:tool_result`. */
function kindOf(entry: StreamEntry): string {
  return `${entry.kind}:${entry.kind === 'event' ? entry.event.type : entry.update.type}`;
}

/** Where `seq` jumps from one entry to the next (a lost write, or a stream read in part). */
function gapsIn(entries: readonly StreamEntry[]): SeqGap[] {
  const gaps: SeqGap[] = [];

  entries.forEach((entry, index) => {
    const before = entries[index - 1];

    if (before && entry.seq !== before.seq + 1) gaps.push({ after: before.seq, next: entry.seq });
  });

  return gaps;
}

/** What the session updates say, last one per session; a Map keeps the order first seen. */
function sessionsIn(entries: readonly StreamEntry[]): SessionSummary[] {
  const sessions = new Map<string, SessionSummary>();

  for (const entry of entries) {
    if (entry.kind !== 'update' || !('session' in entry.update)) continue;

    const { session } = entry.update;

    sessions.set(session.id, {
      id: session.id,
      title: session.title,
      ...('parentId' in session && { parent: session.parentId }),
      state: session.state,
      ...(session.lastOutcome !== undefined && { lastOutcome: session.lastOutcome }),
    });
  }

  return [...sessions.values()];
}

/** The task updates, last one per task. */
function tasksIn(entries: readonly StreamEntry[]): TaskSummary[] {
  const tasks = new Map<string, TaskSummary>();

  for (const entry of entries) {
    if (entry.kind !== 'task') continue;

    const { task } = entry.update;

    tasks.set(task.id, {
      id: task.id,
      command: task.command,
      status: task.status,
      ...(task.exitCode !== undefined && { exitCode: task.exitCode }),
    });
  }

  return [...tasks.values()];
}

/**
 * What a stored stream says about itself: counts per kind, the sessions and tasks as their last
 * update left them, gaps in `seq`, the file's damage, and how the main session's run ended.
 * A stream with no `outcome` never saw its `done`: the run was cut off or is still going.
 */
export function summarizeStream(stream: StoredStream): ReplaySummary {
  const { entries } = stream;
  const kinds: Record<string, number> = {};
  const outcome = entries.map(runEnd).findLast((ended) => ended !== undefined);

  for (const entry of entries) kinds[kindOf(entry)] = (kinds[kindOf(entry)] ?? 0) + 1;

  return {
    source: stream.source,
    entries: entries.length,
    kinds,
    sessions: sessionsIn(entries),
    tasks: tasksIn(entries),
    gaps: gapsIn(entries),
    truncatedLastLine: stream.truncatedLastLine,
    invalidLines: stream.invalidLines,
    ...(outcome !== undefined && { outcome }),
  };
}
