import type { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import type { ApprovalConcern } from '@sheavly/protocol/approval/approval.types';
import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { requireOpenSession } from './open-session.helper.js';
import { MAX_CONCERN_TEXT_CHARS, MAX_REQUEST_CONCERNS } from './run-services.constants.js';
import type { ScopeGuard } from './scope-guard.service.js';
import type { ApprovalRequester } from './run-services.types.js';

type LooseConcern = Partial<Record<keyof ApprovalConcern, unknown>> | null;

function isConcern(concern: LooseConcern): concern is ApprovalConcern {
  return typeof concern?.argument === 'string' && typeof concern.reason === 'string';
}

/**
 * The concerns a request carries, rebuilt from what the caller passed: a non-array is none, an
 * entry without two string fields is dropped, each keeps only those two fields cut to a bounded
 * length, and only the first few are kept, so a request cannot flood the prompt.
 */
function cleanConcerns(concerns: unknown): ApprovalConcern[] {
  if (!Array.isArray(concerns)) return [];

  return (concerns as LooseConcern[])
    .filter(isConcern)
    .slice(0, MAX_REQUEST_CONCERNS)
    .map(({ argument, reason }) => ({
      argument: argument.slice(0, MAX_CONCERN_TEXT_CHARS),
      reason: reason.slice(0, MAX_CONCERN_TEXT_CHARS),
    }));
}

/**
 * `ApprovalRequester` for one extension: it asks the user to approve something and reads whether
 * anyone is there to answer, both under `approval:request`. Answering belongs to the UI and the
 * app, so `respond`, `subscribe`, `observe`, `pending` and `screen` are not here.
 *
 * The scope builds the request itself from the fields it takes: `tool` names the extension
 * (`extension:<name>`, so a screener sees who asks), the command the user reads is prefixed with
 * the name, and only the default options are offered with no `keeps`: an extension's request is
 * answered once and can never become a permanent or session allow rule. `concerns` is rebuilt
 * as `{ argument, reason }` strings, whatever the caller passed.
 *
 * The `[name]` prefix is a label, not an unforgeable attribution: the caller's text follows it
 * and may hold newlines (a terminal shows control characters as literals), so a line can imitate
 * another prefix. `tool` (`extension:<name>`) is what a screener should trust. A request for
 * `sessionId` is accepted for any session open in the run, not only one this extension started.
 */
export class ApprovalsScope implements ApprovalRequester {
  readonly #guard: ScopeGuard;
  readonly #registry: Pick<ApprovalRegistry, 'request' | 'listening'>;

  readonly #sessions: Pick<SessionRegistry, 'get'>;

  constructor(params: {
    guard: ScopeGuard;
    registry: Pick<ApprovalRegistry, 'request' | 'listening'>;
    sessions: Pick<SessionRegistry, 'get'>;
  }) {
    this.#guard = params.guard;
    this.#registry = params.registry;
    this.#sessions = params.sessions;
    Object.freeze(this);
  }

  request: ApprovalRequester['request'] = async (params) => {
    this.#guard.check('approval:request');

    const { callId, sessionId, command, concerns, signal } = params;
    const name = this.#guard.extension;

    if (sessionId !== undefined) {
      requireOpenSession({ sessions: this.#sessions, id: sessionId, refused: 'it cannot ask' });
    }

    // Built field by field: whatever else the caller passed (`options`, `keeps`, `tool`) is dropped.
    return await this.#registry.request({
      callId,
      sessionId,
      tool: `extension:${name}`,
      command: `[${name}] ${command}`,
      concerns: cleanConcerns(concerns),
      signal,
    });
  };

  /** Whether a UI is subscribed to answer: without one, a request is refused at once. */
  get listening(): boolean {
    this.#guard.check('approval:request');

    return this.#registry.listening;
  }
}
