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

export const APPROVALS_GRANTS = ['approval:request'] as const;

/** At most this many concerns reach the user from one request; the rest are dropped. */
export const MAX_REQUEST_CONCERNS = 20;

/** The longest `argument` or `reason` a concern keeps, in characters; more is cut. */
export const MAX_CONCERN_TEXT_CHARS = 500;
