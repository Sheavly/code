import type { ApprovalRequester } from '@sheavly/extension/run-services/run-services.types';
import type { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import type { ApprovalConcern } from '@sheavly/protocol/approval/approval.types';
import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { ApprovalToolNotContributedError } from '../errors/scopes.errors.js';
import { parseKeepRequest } from './approval-keeps.helper.js';
import { requireOpenSession } from './open-session.helper.js';
import {
  HIGH_SURROGATE_FIRST,
  HIGH_SURROGATE_LAST,
  MAX_CONCERN_TEXT_CHARS,
  MAX_REQUEST_CONCERNS,
} from './run-services.constants.js';
import type { ScopeGuard } from './scope-guard.service.js';

type LooseConcern = Partial<Record<keyof ApprovalConcern, unknown>> | null;

function isConcern(concern: LooseConcern): concern is ApprovalConcern {
  return typeof concern?.argument === 'string' && typeof concern.reason === 'string';
}

/**
 * `text`, or its first characters ending in `…` when it is over the cap, the mark counted in it.
 * A cut that would fall between the two halves of a surrogate pair drops the first half, so the
 * text never ends in half a character.
 */
function cutVisibly(text: string): string {
  if (text.length <= MAX_CONCERN_TEXT_CHARS) return text;

  const kept = text.slice(0, MAX_CONCERN_TEXT_CHARS - 1);
  const lastUnit = kept.charCodeAt(kept.length - 1);
  const splitsPair = lastUnit >= HIGH_SURROGATE_FIRST && lastUnit <= HIGH_SURROGATE_LAST;

  return `${splitsPair ? kept.slice(0, -1) : kept}…`;
}

/**
 * The concerns a request carries, rebuilt from what the caller passed: a non-array is none, an
 * entry without two string fields is dropped, each keeps only those two fields, and the prompt
 * cannot be flooded. Nothing is cut silently: a long text ends in `…`, and over the cap the first
 * ones are kept with a final concern that counts the rest.
 */
function cleanConcerns(concerns: unknown): ApprovalConcern[] {
  if (!Array.isArray(concerns)) return [];

  const valid = (concerns as LooseConcern[]).filter(isConcern);
  const shown =
    valid.length <= MAX_REQUEST_CONCERNS ? valid : valid.slice(0, MAX_REQUEST_CONCERNS - 1);
  const cleaned = shown.map(({ argument, reason }) => ({
    argument: cutVisibly(argument),
    reason: cutVisibly(reason),
  }));

  if (valid.length <= MAX_REQUEST_CONCERNS) return cleaned;

  return [
    ...cleaned,
    {
      argument: `+${String(valid.length - shown.length)} more`,
      reason: `not shown here: the request had ${String(valid.length)} concerns`,
    },
  ];
}

/**
 * `ApprovalRequester` for one extension: it asks the user to approve something and reads whether
 * anyone is there to answer, both under `approval:request`. Answering belongs to the UI and the
 * app, so `respond`, `subscribe`, `observe`, `pending` and `screen` are not here.
 *
 * The scope builds the request itself from the fields it takes. By default `tool` names the
 * extension (`extension:<name>`, so a screener sees who asks), the command the user reads is
 * prefixed with the name, and only the default options are offered with no `keeps`: the request
 * is answered once and can never become a permanent or session allow rule. `concerns` is rebuilt
 * as `{ argument, reason }` strings, whatever the caller passed.
 *
 * Two more grants widen that, each only when its field is used (a request using a field without
 * its grant is refused with `ExtensionUndeclaredError`, never silently narrowed).
 * `approval:as-tool` lets `tool` name a tool the extension contributes, as the host recorded and
 * checked it after `activate` returned (else `ApprovalToolNotContributedError`, which a request
 * made during `activate` gets too): it is then passed as given and the command is not prefixed.
 * Contributed names are unique across a run, so no other extension is attributed as that tool.
 * `approval:keep` lets `options` and `keeps` through, parsed with the protocol's schemas
 * and bounded (`ScopeArgumentError` otherwise); `always_allow` and `allow_session` need a
 * non-empty `keeps`, which the user is shown in the prompt.
 *
 * The `[name]` prefix is a label, not an unforgeable attribution: the caller's text follows it
 * and may hold newlines (a terminal shows control characters as literals), so a line can imitate
 * another prefix. `tool` is what a screener should trust. A request for
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

    // The extra fields are checked before anything is asked, and only when used: a request that
    // uses one without its grant is refused, not answered as if the field were not there.
    const asker = this.#asker({ tool: params.tool, command });
    const keeping = this.#keeping({ options: params.options, keeps: params.keeps });

    if (sessionId !== undefined) {
      requireOpenSession({ sessions: this.#sessions, id: sessionId, refused: 'it cannot ask' });
    }

    // Built field by field: whatever else the caller passed is dropped.
    return await this.#registry.request({
      callId,
      sessionId,
      ...asker,
      concerns: cleanConcerns(concerns),
      ...keeping,
      signal,
    });
  };

  /** Who the request is attributed to, and the command the user reads. */
  #asker(params: { tool: string | undefined; command: string }): { tool: string; command: string } {
    const { tool, command } = params;
    const name = this.#guard.extension;

    if (tool === undefined) return { tool: `extension:${name}`, command: `[${name}] ${command}` };

    this.#guard.check('approval:as-tool');

    if (!this.#guard.contributedTools.includes(tool)) {
      throw new ApprovalToolNotContributedError({ extension: name, tool });
    }

    return { tool, command };
  }

  /** What the request offers and keeps: the registry's defaults unless `approval:keep` is held. */
  #keeping(params: { options: unknown; keeps: unknown }): ReturnType<typeof parseKeepRequest> {
    if (params.options === undefined && params.keeps === undefined) return {};

    this.#guard.check('approval:keep');

    return parseKeepRequest(params);
  }

  /** Whether a UI is subscribed to answer: without one, a request is refused at once. */
  get listening(): boolean {
    this.#guard.check('approval:request');

    return this.#registry.listening;
  }
}
