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
  /** Does the work. Must stop when `signal` aborts; reports output as it arrives. */
  run: (params: {
    signal: AbortSignal;
    onOutput: (chunk: string) => void;
  }) => Promise<{ exitCode: number | null }>;
};

/** How a task ended: its exit code, or the error that stopped it. */
export type TaskResult = { exitCode?: number | null; error?: string };

/** A task update, with the session whose tool started it (unset for one started outside a run). */
export type TaskObserver = (params: { update: TaskUpdate; sessionId?: SessionId }) => void;
