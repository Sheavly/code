import type { ApprovalRegistry } from '../approvals/approvals.service.js';

/** A UI that approves every request as soon as it's announced. Returns the unsubscribe. */
export function approveEverything(approvals: ApprovalRegistry): () => void {
  return approvals.subscribe((update) => {
    if (update.type === 'approval_requested') {
      approvals.respond({ id: update.request.id, response: { decision: 'approve' } });
    }
  });
}
