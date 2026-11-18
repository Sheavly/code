import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { TaskId, TaskInfo } from '@sheavly/protocol/task/task.types';
import type { TaskObserver } from './tasks.types.js';
import type { WorkDefinition } from './work.types.js';

/**
 * The one thing `startWork` needs: something that starts a work kind's `WorkDefinition`. The
 * run's `TaskRegistry` and an extension's `BackgroundTaskScope` both satisfy it, so a factory's
 * policy decides the kind whichever of them starts it.
 */
export type TaskStarter = {
  start(work: WorkDefinition): TaskInfo;
};

/**
 * The background tasks one extension started, for the `task:start` (`start`), `task:read` (`get`,
 * `report`, `list`, `observe`) and `task:cancel` (`cancel`, `group`) grants. Every method sees
 * only tasks this scope started; another extension's id reads as unknown. `start` needs the
 * `sessionId` of an open session of the run (`WorkDefinition.sessionId` is required). It never
 * exposes `cancelAll`, `cancelSession`, deliveries or `release*`.
 */
export type BackgroundTaskScope = TaskStarter & {
  get(id: TaskId): TaskInfo | undefined;
  /** The whole report of a settled task, undefined for an unknown or running one. */
  report(id: TaskId): string | undefined;
  list(): TaskInfo[];
  /** Stops an owned task and waits for it to exit; undefined for an id this scope does not own. */
  cancel(id: TaskId): Promise<TaskInfo | undefined>;
  /** As `TaskRegistry.group`, over owned tasks only. Throws `TaskError` atomically. */
  group(params: { ids: TaskId[]; reason: string; sessionId: SessionId }): void;
  /** Observes the start and end of owned tasks only; returns a function that stops it. */
  observe(observer: TaskObserver): () => void;
};

/**
 * What the task tools do to every task of a session whatever started it, for the
 * `task:read-any` (`getOwned`, `list`, `report`) and `task:cancel-any` (`cancel`, `group`) grants.
 * `sessionId` is always required: `TaskRegistry` reads an absent one as every task of the run.
 */
export type TaskControl = {
  /** The task if the session owns it (or it has no owner); anything else reads as unknown. */
  getOwned(params: { id: TaskId; sessionId: SessionId }): TaskInfo | undefined;
  list(sessionId: SessionId): TaskInfo[];
  report(id: TaskId, sessionId: SessionId): string | undefined;
  /** Stops a task the session owns; undefined when it does not. */
  cancel(params: { id: TaskId; sessionId: SessionId }): Promise<TaskInfo | undefined>;
  group(params: { ids: TaskId[]; reason: string; sessionId: SessionId }): void;
};
