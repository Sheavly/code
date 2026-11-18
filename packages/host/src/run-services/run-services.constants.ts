import type { ApprovalOption } from '@sheavly/protocol/approval/approval.types';

/** The grants each scoped run service understands, as a manifest's `grants` may list them. */
export const SESSION_INFO_GRANTS = ['session:read'] as const;

export const CHILD_SESSIONS_GRANTS = [
  'sub-agent:create',
  'sub-agent:message',
  'sub-agent:observe',
  'sub-agent:report',
] as const;

export const BACKGROUND_TASKS_GRANTS = ['task:start', 'task:read', 'task:cancel'] as const;

export const TASK_CONTROL_GRANTS = ['task:read-any', 'task:cancel-any'] as const;

export const OUTPUT_READER_GRANTS = ['output:read'] as const;

export const OUTPUT_CAPTURE_GRANTS = ['output:capture'] as const;

export const MODEL_GRANTS = ['model:call'] as const;

export const APPROVALS_GRANTS = ['approval:request', 'approval:as-tool', 'approval:keep'] as const;

/**
 * At most this many concerns reach the user from one request. A request with more keeps the first
 * one fewer and ends with a concern saying how many are not shown.
 */
export const MAX_REQUEST_CONCERNS = 50;

/** The options whose answer keeps something, so a request offering one must say what. */
export const KEEPING_OPTIONS: readonly ApprovalOption[] = ['always_allow', 'allow_session'];

/** The longest `argument` or `reason` a concern keeps, in characters; a longer one ends with `…`. */
export const MAX_CONCERN_TEXT_CHARS = 1000;

/** The UTF-16 code units that open a surrogate pair: a cut text must not end in one. */
export const HIGH_SURROGATE_FIRST = 0xd800;

export const HIGH_SURROGATE_LAST = 0xdbff;
