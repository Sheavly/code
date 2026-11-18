import type {
  SessionInfoView,
  SessionLifecycleUpdate,
} from '@sheavly/runtime/sessions/session-scope.types';
import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { SessionUpdate } from '@sheavly/protocol/session/session.types';
import type { ScopeGuard } from './scope-guard.service.js';

/** The registry members a `SessionInfoScope` reads: nothing that writes. */
type SessionSource = Pick<
  SessionRegistry,
  'get' | 'list' | 'isReleased' | 'releasedStarts' | 'subscribe'
>;

/** The lifecycle update `update` is, rebuilt without anything else it carries, or undefined. */
function lifecycleOf(update: SessionUpdate): SessionLifecycleUpdate | undefined {
  switch (update.type) {
    case 'session_started':
      return { type: 'session_started', session: update.session };
    case 'session_idle':
      return { type: 'session_idle', session: update.session };
    case 'session_resumed':
      return { type: 'session_resumed', session: update.session };
    case 'session_ended':
      return { type: 'session_ended', session: update.session };
    case 'session_released':
      return { type: 'session_released', session: update.session };
    default:
      return undefined;
  }
}

/**
 * `SessionInfoView` for one extension: every method needs `session:read`. Updates are rebuilt as
 * `{ type, session }` for the five lifecycle types, so a message or any other update never
 * reaches the listener.
 */
export class SessionInfoScope implements SessionInfoView {
  readonly #guard: ScopeGuard;
  readonly #sessions: SessionSource;

  constructor(params: { guard: ScopeGuard; sessions: SessionSource }) {
    this.#guard = params.guard;
    this.#sessions = params.sessions;
    Object.freeze(this);
  }

  get: SessionInfoView['get'] = (id) => {
    this.#guard.check('session:read');

    return this.#sessions.get(id);
  };

  list: SessionInfoView['list'] = () => {
    this.#guard.check('session:read');

    return this.#sessions.list();
  };

  isReleased: SessionInfoView['isReleased'] = (id) => {
    this.#guard.check('session:read');

    return this.#sessions.isReleased(id);
  };

  releasedStarts: SessionInfoView['releasedStarts'] = () => {
    this.#guard.check('session:read');

    return this.#sessions.releasedStarts();
  };

  onLifecycle: SessionInfoView['onLifecycle'] = (listener) => {
    this.#guard.check('session:read');

    return this.#guard.track(
      this.#sessions.subscribe((update) => {
        const lifecycle = lifecycleOf(update);

        if (lifecycle) listener(lifecycle);
      }),
    );
  };
}
