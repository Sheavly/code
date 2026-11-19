import type { ApprovalRequest } from '@sheavly/protocol/approval/approval.types';
import type { scopeRun } from './scope-run.fake.js';

/**
 * Test-only: a UI that approves every request it hears on the run's real registry. Returns the
 * requests it heard, in order, as the registry announced them.
 */
export function approveAll(run: ReturnType<typeof scopeRun>) {
  const heard: ApprovalRequest[] = [];

  run.harness.approvals.subscribe((update) => {
    if (update.type !== 'approval_requested') return;

    heard.push(update.request);
    run.harness.approvals.respond({ id: update.request.id, response: { decision: 'approve' } });
  });

  return heard;
}
