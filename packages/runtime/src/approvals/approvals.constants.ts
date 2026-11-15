import type { ApprovalOption } from '@sheavly/protocol/approval/approval.types';

export const DEFAULT_OPTIONS: readonly ApprovalOption[] = ['approve', 'skip', 'skip_with_message'];

/** What an approval hook may answer: stop the command. Never an approval or a grant: those are the user's. */
export const HOOK_DECISIONS: readonly ApprovalOption[] = ['skip', 'skip_with_message'];
