import type { CallId } from '@sheavly/protocol/message/message.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { TaskUpdate } from '@sheavly/protocol/task/task.types';

/** What to run in the background. */
export type StartTask = {
  command: string;
  description: string;
  callId?: CallId;
  /** The session whose tool started it: its start and end go in that session's stream. */
  sessionId?: SessionId | undefined;
  /** Keep the calling run alive until this task's result has been delivered to the model. */
  waitForCompletion?: boolean;
  /**
   * Does the work. Must stop when `signal` aborts; reports output as it arrives. `output` is a
   * bounded preview. A task whose result is a document (a sub-agent's report) returns it as
   * `report` instead: it is kept whole, never shortened, and never mixed with progress output.
   */
  run: (params: {
    signal: AbortSignal;
    onOutput: (chunk: string) => void;
  }) => Promise<{ exitCode: number | null; report?: string }>;
};

/** How a task ended: its exit code and report, or the error that stopped it. */
export type TaskResult = { exitCode?: number | null; error?: string; report?: string };

/** A task update, with the session whose tool started it (unset for one started outside a run). */
export type TaskObserver = (params: { update: TaskUpdate; sessionId?: SessionId }) => void;
