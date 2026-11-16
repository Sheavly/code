import type { ApprovalOption } from '@sheavly/protocol/approval/approval.types';

export const DEFAULT_OPTIONS: readonly ApprovalOption[] = ['approve', 'skip', 'skip_with_message'];

/**
 * The approval state machine, the one table every reader asks. A request is `requested` until it
 * reaches a terminal state, once: `answered` (a `respond`, or a screener's answer), `cancelled`
 * (its call was interrupted, or its session ended) or `expired` (it failed closed because nobody
 * could hear it: no listener, or a listener that threw). A refused move leaves the state as it was.
 */
export const APPROVAL_TABLE = {
  requested: ['answered', 'cancelled', 'expired'],
  answered: [],
  cancelled: [],
  expired: [],
} as const;

/** How many settled approvals the registry remembers, oldest forgotten first. */
export const SETTLED_KEPT = 500;

/** What an approval hook may answer: stop the command. Never an approval or a grant: those are the user's. */
export const HOOK_DECISIONS: readonly ApprovalOption[] = ['skip', 'skip_with_message'];
