import type { ChildSessionScope } from '@sheavly/extension/run-services/run-services.types';
import type { SessionId, SessionRef } from '@sheavly/protocol/session/session.types';
import { SessionError } from '@sheavly/runtime/errors/sessions.errors';
import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { ChildRunningError } from '../errors/scopes.errors.js';
import { runChildLoop } from './child-run.helper.js';
import { requireOpenSession } from './open-session.helper.js';
import type { RunLoop } from './run-services.types.js';
import type { ScopeGuard } from './scope-guard.service.js';

/**
 * `ChildSessionScope` for one extension. It remembers the sub-agents it started (a private set,
 * so another extension's scope, built over the same registry, owns its own) and acts only on
 * those: any other id reads as an unknown session. The registry and the task registry stay
 * private; `runChild` is the one place they reach the loop.
 */
export class ChildSessionsScope implements ChildSessionScope {
  readonly #guard: ScopeGuard;
  readonly #registry: SessionRegistry;
  readonly #tasks: TaskRegistry;
  readonly #main: SessionRef;
  readonly #runLoop: RunLoop;
  /** Private frozen records: only copies of them ever leave the scope. */
  readonly #owned = new Map<SessionId, SessionRef>();
  /** The children with a `runChild` in flight: a second run on one is refused. */
  readonly #running = new Set<SessionId>();

  constructor(params: {
    guard: ScopeGuard;
    registry: SessionRegistry;
    tasks: TaskRegistry;
    main: SessionRef;
    runLoop: RunLoop;
  }) {
    this.#guard = params.guard;
    this.#registry = params.registry;
    this.#tasks = params.tasks;
    this.#main = Object.freeze({ ...params.main });
    this.#runLoop = params.runLoop;
    Object.freeze(this);
  }

  startChild: ChildSessionScope['startChild'] = (params) => {
    const { parentId, startedByCall, title } = params;

    this.#guard.check('sub-agent:create');

    if (parentId !== this.#main.id) this.#requireOwned(parentId);

    const child = this.#registry.startChild({ parentId, startedByCall, title });

    this.#owned.set(child.id, Object.freeze({ ...child }));

    // A different object from the one kept: whatever the caller does to it, the scope's own
    // record (what the loop is handed) stays as the registry made it.
    return Object.freeze({ ...child });
  };

  setModel: ChildSessionScope['setModel'] = (params) => {
    this.#guard.check('sub-agent:create');
    this.#requireOwned(params.id);
    this.#registry.setModel(params);
  };

  send: ChildSessionScope['send'] = (params) => {
    this.#guard.check('sub-agent:message');
    this.#requireOwned(params.id);

    if (params.from !== this.#main.id) this.#requireOwned(params.from);

    this.#registry.send(params);
  };

  report: ChildSessionScope['report'] = (params) => {
    this.#guard.check('sub-agent:report');
    this.#requireOwned(params.id);
    this.#registry.report(params);
  };

  onUpdate: ChildSessionScope['onUpdate'] = (listener) => {
    this.#guard.check('sub-agent:observe');

    return this.#guard.track(
      this.#registry.subscribe((update) => {
        if (this.#owned.has(update.session.id)) listener(update);
      }),
    );
  };

  // Async so a refusal rejects, like any failure of the run, instead of throwing before a promise exists.
  runChild: ChildSessionScope['runChild'] = async (params) => {
    this.#guard.check('sub-agent:create');

    const { child: given, ...run } = params;

    const child = this.#requireOwned(given.id);

    requireOpenSession({ sessions: this.#registry, id: child.id, refused: 'it cannot run' });

    if (this.#running.has(child.id)) throw new ChildRunningError({ sessionId: child.id });

    this.#running.add(child.id);

    try {
      return await runChildLoop({
        runLoop: this.#runLoop,
        registry: this.#registry,
        tasks: this.#tasks,
        child,
        run,
      });
    } finally {
      this.#running.delete(child.id);
    }
  };

  /** The session `id` if this scope started it; anything else is refused as unknown. */
  #requireOwned(id: SessionId): SessionRef {
    const child = this.#owned.get(id);

    if (child) return child;

    throw new SessionError({
      reason: 'unknown_session',
      sessionId: id,
      message: `Unknown session ${id}`,
    });
  }
}
