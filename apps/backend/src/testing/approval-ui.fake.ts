import type { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import type { ApprovalRequest, ApprovalResponse } from '@sheavly/protocol/approval/approval.types';
import { ALL_GRANTS, APPROVAL_WIDENING_GRANTS } from './testing.constants.js';

/** Test-only: every grant but the two that widen an approval request. */
export const GRANTS_WITHOUT_APPROVAL_WIDENING = ALL_GRANTS.filter(
  (grant) => !APPROVAL_WIDENING_GRANTS.includes(grant),
);

/**
 * Test-only: a UI on a run's approvals that answers every request it hears with `response`
 * (approve by default). Returns the requests it heard, in order, so a test reads what reached it.
 */
export function listenAndAnswer(
  harness: { approvals: Pick<ApprovalRegistry, 'subscribe' | 'respond'> },
  response: ApprovalResponse = { decision: 'approve' },
): ApprovalRequest[] {
  const heard: ApprovalRequest[] = [];

  harness.approvals.subscribe((update) => {
    if (update.type !== 'approval_requested') return;

    heard.push(update.request);
    harness.approvals.respond({ id: update.request.id, response });
  });

  return heard;
}
