import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { TaskControl } from '@sheavly/runtime/tasks/task-scope.types';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { ScopeArgumentError } from '../errors/scopes.errors.js';
import type { ScopeGuard } from './scope-guard.service.js';

/** The registry members a `TaskControlScope` uses: no `start`, `cancelAll`, `cancelSession` or deliveries. */
type TaskSource = Pick<TaskRegistry, 'getOwned' | 'list' | 'report' | 'cancel' | 'group'>;

/**
 * `TaskControl` for one extension: what the task tools do to every task of the calling session,
 * whatever started it. It owns nothing; the session is the scope of every call, so each needs a
 * `sessionId` (the registry reads an absent one as every task of the run) and refuses without.
 */
export class TaskControlScope implements TaskControl {
  readonly #guard: ScopeGuard;
  readonly #tasks: TaskSource;

  constructor(params: { guard: ScopeGuard; tasks: TaskSource }) {
    this.#guard = params.guard;
    this.#tasks = params.tasks;
    Object.freeze(this);
  }

  getOwned: TaskControl['getOwned'] = ({ id, sessionId }) => {
    this.#guard.check('task:read-any');

    return this.#tasks.getOwned({ id, sessionId: this.#required(sessionId) });
  };

  list: TaskControl['list'] = (sessionId) => {
    this.#guard.check('task:read-any');

    return this.#tasks.list(this.#required(sessionId));
  };

  report: TaskControl['report'] = (id, sessionId) => {
    this.#guard.check('task:read-any');

    return this.#tasks.getOwned({ id, sessionId: this.#required(sessionId) })
      ? this.#tasks.report(id)
      : undefined;
  };

  // The ownership check and the cancel happen in one call with nothing awaited between them, so
  // the answer cannot be stale when the task is stopped.
  cancel: TaskControl['cancel'] = async ({ id, sessionId }) => {
    this.#guard.check('task:cancel-any');

    if (!this.#tasks.getOwned({ id, sessionId: this.#required(sessionId) })) return undefined;

    return await this.#tasks.cancel(id);
  };

  group: TaskControl['group'] = (params) => {
    this.#guard.check('task:cancel-any');
    this.#tasks.group({ ...params, sessionId: this.#required(params.sessionId) });
  };

  #required(sessionId: SessionId | undefined): SessionId {
    if (sessionId !== undefined) return sessionId;

    throw new ScopeArgumentError('A task control call needs the sessionId it is about');
  }
}
