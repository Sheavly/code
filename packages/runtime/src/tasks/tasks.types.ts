import type { OutputWriter } from '@sheavly/core/output/output.types';
import type { CallId } from '@sheavly/protocol/message/message.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { TaskId, TaskInfo, TaskUpdate } from '@sheavly/protocol/task/task.types';

/** What to run in the background. */
export type StartTask = {
  command: string;
  description: string;
  callId?: CallId;
  /** The session whose tool started it: its start and end go in that session's stream. */
  sessionId?: SessionId | undefined;
  /**
   * Where the complete output goes. The registry appends every chunk, shows the log's reference
   * and completeness on the task (`TaskInfo.outputLog`) while it runs, and closes it when the
   * task ends, so the output of a failed or cancelled task stays readable.
   */
  capture?: OutputWriter | undefined;
  /** Finite work keeps its run alive until delivered; services do not. Defaults to task. */
  backgroundKind?: 'task' | 'service';
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

/** One notice the registry holds until it is delivered: a single task or a group's members. */
export type Delivery = { ids: TaskId[]; reason?: string; delivered: boolean };

/** What the registry keeps for one task. */
export type Entry = {
  info: TaskInfo;
  controller: AbortController;
  settled: Promise<void>;
  silent: boolean;
  sessionId?: SessionId | undefined;
  backgroundKind: 'task' | 'service';
  /** Membership survives delivery until this entry is released. */
  group?: Delivery;
  /** The notice of an ungrouped task, set when it settles unsilenced and dropped when grouped. */
  delivery?: Delivery;
  /** Whole result, outside the bounded preview and task events. */
  report?: string | undefined;
};

/** One completion notice: a single task, or a whole group in requested ID order. */
export type TaskDelivery = { tasks: TaskInfo[]; reason?: string };

/** How a task ended: its exit code and report, or the error that stopped it. */
export type TaskResult = { exitCode?: number | null; error?: string; report?: string };

/** A task update, with the session whose tool started it (unset for one started outside a run). */
export type TaskObserver = (params: { update: TaskUpdate; sessionId?: SessionId }) => void;
