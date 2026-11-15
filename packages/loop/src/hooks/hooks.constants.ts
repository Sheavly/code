/** How long a `sessionEnd` or `onError` hook may take before the run ends without it. */
export const SESSION_END_TIMEOUT_MS = 5_000;

/** How long an `approval` hook may take before the command is skipped (it fails closed). */
export const APPROVAL_HOOK_TIMEOUT_MS = 30_000;
