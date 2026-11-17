import type { RunOutcome, SessionId, SessionState } from '@sheavly/protocol/session/session.types';
import type { Write } from '../render/render.types.js';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type { TaskId } from '@sheavly/protocol/task/task.types';

/** Where a stored stream came from: a conversation's `stream.jsonl`, or a run's `sessions.sse`. */
export type StreamSource = 'conversation' | 'run';

/**
 * What was read from a stored stream, and what was wrong with the file. `invalidLines` are 1-based
 * numbers of lines (or frames) that were not an entry; their text is never kept, since a stored
 * conversation is private.
 */
export type StoredStream = {
  source: StreamSource;
  file: string;
  entries: StreamEntry[];
  /** The last line (or frame) was cut off, as a crash leaves it; it is not in `entries`. */
  truncatedLastLine: boolean;
  invalidLines: number[];
};

/** Where replay writes: `write`, and the error that stopped the output (not a reader leaving). */
export type ReplayOutput = {
  write: Write;
  /**
   * The first error of the output that is not its reader having gone, or `undefined`, once what
   * was written has reached the output.
   */
  failure: () => Promise<Error | undefined>;
};

/** What the replay command line asks for. */
export type ReplayOptions = {
  /** A folder, or a workbook run by id, number or `last`. */
  target: string;
  /** The first `seq` to replay. */
  from: number;
  /** Only this session's entries, and the one the renderer takes as the main session. */
  session?: SessionId;
  json: boolean;
  summary: boolean;
};

/** A jump in `seq`: the entry after `after` was `next`, not `after + 1`. */
export type SeqGap = { after: number; next: number };

/** A session as its last update left it. */
export type SessionSummary = {
  id: SessionId;
  title: string;
  /** The session that started it; none for the main session. */
  parent?: SessionId;
  state: SessionState;
  lastOutcome?: RunOutcome;
};

/** A background task as its last update left it. */
export type TaskSummary = {
  id: TaskId;
  command: string;
  status: string;
  exitCode?: number | null;
};

/** What a stored stream says about itself, for a person debugging a conversation. */
export type ReplaySummary = {
  source: StreamSource;
  entries: number;
  /** How many entries of each `<kind>:<type>`, in the order first seen. */
  kinds: Record<string, number>;
  sessions: SessionSummary[];
  tasks: TaskSummary[];
  gaps: SeqGap[];
  truncatedLastLine: boolean;
  invalidLines: number[];
  /** How the main session's run ended, when its `done` is there; else the run never ended. */
  outcome?: RunOutcome;
};
