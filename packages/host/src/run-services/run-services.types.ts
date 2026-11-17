import type { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';

/**
 * What an extension may do with approvals: ask the user. Answering belongs to the UI and the app,
 * so the registry's `respond` (and `subscribe`, `observe`, `pending`) is not here. Approvals still
 * appear in the sessions' stream that the `SESSIONS` service exposes.
 */
export type ApprovalRequester = {
  request: ApprovalRegistry['request'];
};
