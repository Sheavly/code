/**
 * Background tasks: long-running work (dev servers, slow builds) that outlives the tool call
 * that started it. The registry owns their lifecycle; the loop reports completions to the
 * model and UI at turn boundaries, through its one ordered event queue.
 */
import { MAX_TASK_OUTPUT_CHARS } from './tasks.constants.js';
import type { StartTask, TaskObserver, TaskResult } from './tasks.types.js';
import type { CallId } from '@sheavly/protocol/message/message.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { TaskId, TaskInfo, TaskStatus, TaskUpdate } from '@sheavly/protocol/task/task.types';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';

type Entry = {
  info: TaskInfo;
  controller: AbortController;
  settled: Promise<void>;
  /** Cancelled on request: whoever cancelled it already knows, so no notification. */
  silent: boolean;
  sessionId?: SessionId | undefined;
};

export class TaskRegistry {
  #tasks = new Map<TaskId, Entry>();
  #nextId = 1;
  /** Finished tasks the model hasn't been told about yet, in the order they finished. */
  #unreported: TaskId[] = [];
  #waiters: (() => void)[] = [];
  #observers = new Set<TaskObserver>();

  start({ command, description, callId, sessionId, run }: StartTask): TaskInfo {
    const id = taskIdSchema.parse(`t${this.#nextId++}`);
    const controller = new AbortController();
    const info: TaskInfo = {
      id,
      ...(callId ? { callId } : {}),
      command,
      description,
      status: 'running',
      startedAt: Date.now(),
      output: '',
    };
    const entry: Entry = { info, controller, settled: Promise.resolve(), silent: false, sessionId };

    const onOutput = (chunk: string) => {
      info.output = (info.output + chunk).slice(-MAX_TASK_OUTPUT_CHARS);
    };

    entry.settled = run({ signal: controller.signal, onOutput }).then(
      ({ exitCode }) => {
        this.#settle({
          entry,
          status: exitCode === 0 ? 'completed' : 'failed',
          result: { exitCode },
        });
      },
      (caughtError: unknown) => {
        const error = caughtError instanceof Error ? caughtError.message : String(caughtError);

        this.#settle({ entry, status: 'failed', result: { error } });
      },
    );

    this.#tasks.set(id, entry);
    this.#notify({ entry, type: 'task_started' });

    return { ...info };
  }

  /**
   * Calls `observer` with every task's start and end from now on (a cancelled one's too, which the
   * model isn't told about). Returns a function that stops it.
   */
  observe(observer: TaskObserver): () => void {
    this.#observers.add(observer);

    return () => {
      this.#observers.delete(observer);
    };
  }

  get(id: TaskId): TaskInfo | undefined {
    const entry = this.#tasks.get(id);

    return entry && { ...entry.info };
  }

  list(): TaskInfo[] {
    return [...this.#tasks.values()].map((e) => ({ ...e.info }));
  }

  byCallId(callId: CallId): TaskInfo | undefined {
    return this.list().find((t) => t.callId === callId);
  }

  get runningCount(): number {
    return this.list().filter((t) => t.status === 'running').length;
  }

  /** Stops a task and waits for it to exit. Returns undefined for unknown ids. */
  async cancel(id: TaskId): Promise<TaskInfo | undefined> {
    const entry = this.#tasks.get(id);

    if (!entry) return undefined;

    if (entry.info.status === 'running') {
      entry.silent = true;
      entry.controller.abort();
      await entry.settled;
    }

    return { ...entry.info };
  }

  /** Stops everything still running (e.g. on shutdown). */
  async cancelAll(): Promise<void> {
    await Promise.all(this.list().map((t) => this.cancel(t.id)));
  }

  /** Finished tasks not yet reported, oldest first. Each task is returned only once. */
  takeUnreported(): TaskInfo[] {
    const ids = this.#unreported.splice(0);

    return ids.map((id) => this.get(id)).filter((t) => t !== undefined);
  }

  get hasUnreported(): boolean {
    return this.#unreported.length > 0;
  }

  /** Resolves the next time any task finishes. */
  nextSettled(): Promise<void> {
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  #settle(params: { entry: Entry; status: TaskStatus; result: TaskResult }) {
    const { entry, status, result } = params;
    const { info } = entry;

    info.status = entry.controller.signal.aborted ? 'cancelled' : status;
    info.endedAt = Date.now();
    if ('exitCode' in result) info.exitCode = result.exitCode;
    if (result.error) info.error = result.error;

    if (!entry.silent) this.#unreported.push(info.id);
    this.#notify({ entry, type: 'task_ended' });
    this.#waiters.splice(0).forEach((wake) => wake());
  }

  #notify(params: { entry: Entry; type: TaskUpdate['type'] }) {
    const { entry, type } = params;

    for (const observer of this.#observers) {
      observer({
        update: { type, task: { ...entry.info } },
        ...(entry.sessionId && { sessionId: entry.sessionId }),
      });
    }
  }
}
