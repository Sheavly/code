import type { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
import type { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';

/**
 * What an extension says when it asks: the call, what it wants to do (`command`, the text the user
 * reads) and why it is unusual (`concerns`). The scope builds the rest: the request is
 * attributed to the extension, is answered once (no `always_allow`, no `allow_session`) and keeps
 * nothing, so an extension cannot add a permanent or session allow rule. `sessionId`, when given,
 * must be an open session of the run.
 */
export type ExtensionApprovalRequest = Pick<
  Parameters<ApprovalRegistry['request']>[0],
  'callId' | 'sessionId' | 'command' | 'concerns' | 'signal'
>;

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
