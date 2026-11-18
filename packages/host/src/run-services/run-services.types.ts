import type { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
import type { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';

/**
 * What an extension says when it asks: the call, what it wants to do (`command`, the text the user
 * reads) and why it is unusual (`concerns`). Unless the extension holds the grants below, the
 * scope builds the rest: the request is attributed to the extension, is answered once (no
 * `always_allow`, no `allow_session`) and keeps nothing, so an extension cannot add a permanent or
 * session allow rule. `sessionId`, when given, must be an open session of the run. Using `tool`,
 * `options` or `keeps` without its grant is refused, never ignored.
 */
export type ExtensionApprovalRequest = Pick<
  Parameters<ApprovalRegistry['request']>[0],
  'callId' | 'sessionId' | 'command' | 'concerns' | 'signal'
> & {
  /**
   * Asks as one of the tools the extension contributes (needs `approval:as-tool`): the request
   * carries this name and the `command` is not prefixed. A name it does not contribute, or any
   * name during `activate`, is refused.
   */
  tool?: string | undefined;
  /**
   * What the user may answer, a subset of the protocol's options (needs `approval:keep`).
   * `always_allow` and `allow_session` need a non-empty `keeps`.
   */
  options?: Parameters<ApprovalRegistry['request']>[0]['options'];
  /** What those two answers would keep, shown to the user (needs `approval:keep`). */
  keeps?: Parameters<ApprovalRegistry['request']>[0]['keeps'];
};

/**
 * What an extension may do with approvals (the `approval:request` grant): ask the user, and read
 * whether anyone is there to answer. Answering belongs to the UI and the app, so the registry's
 * `respond` (and `subscribe`, `observe`, `pending`, `screen`) is not here. Approvals still appear
 * in the run's combined stream, which no scoped service exposes.
 */
export type ApprovalRequester = {
  request: (params: ExtensionApprovalRequest) => ReturnType<ApprovalRegistry['request']>;
  /** Whether a UI is subscribed to answer: without one, a request is refused at once. */
  readonly listening: boolean;
};

/**
 * The loop's runner for one nested session, which `child-sessions` calls from `runChild` with the
 * run's full registries. The app passes the loop's `runSession`: the extension never holds it.
 */
export type RunLoop = typeof runSession;
