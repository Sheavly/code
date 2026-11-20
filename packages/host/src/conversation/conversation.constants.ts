/**
 * After a run ended because the user queued a line, the conversation waits this long before it
 * wakes for finished work: the queued line normally arrives as the next prompt in that time and
 * delivers the notice itself. A line that is not a prompt (`/help`) leaves the notice to the wake.
 */
export const WAKE_AFTER_YIELD_MS = 1500;
