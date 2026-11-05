import type { ApprovalOption } from '@sheavly/protocol/approval/approval.types';

/** The options in the order the prompt lists them, whichever of them a request offers. */
export const APPROVAL_ORDER: readonly ApprovalOption[] = [
  'approve',
  'always_allow',
  'skip',
  'skip_with_message',
];

/** What each option is called, and what it does. */
export const APPROVAL_LABELS: Record<ApprovalOption, { label: string; hint: string }> = {
  approve: { label: 'Run it once', hint: 'asks again next time' },
  always_allow: { label: 'Always allow', hint: 'runs it, and keeps it allowed in this folder' },
  skip: { label: 'Skip', hint: 'the model is told not to retry it' },
  skip_with_message: { label: 'Skip, and say what to do instead', hint: 'you type a message' },
};
