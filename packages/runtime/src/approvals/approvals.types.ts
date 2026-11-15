import type { ApprovalRequest } from '@sheavly/protocol/approval/approval.types';

/**
 * Looks at a request before any UI hears of it: an answer settles it, nothing leaves it to the
 * user. Typed `unknown` on the way out because a screener may be plain JavaScript (a project hook).
 */
export type Screener = (params: {
  request: ApprovalRequest;
  signal: AbortSignal;
}) => Promise<unknown>;
