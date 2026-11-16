import type { ApprovalRequest } from '@sheavly/protocol/approval/approval.types';
import type { APPROVAL_TABLE } from './approvals.constants.js';

/** Where an approval is in its life; `APPROVAL_TABLE` says which moves are allowed. */
export type ApprovalState = keyof typeof APPROVAL_TABLE;

/**
 * Looks at a request before any UI hears of it: an answer settles it, nothing leaves it to the
 * user. Typed `unknown` on the way out because a screener may be plain JavaScript (a project hook).
 */
export type Screener = (params: {
  request: ApprovalRequest;
  signal: AbortSignal;
}) => Promise<unknown>;
