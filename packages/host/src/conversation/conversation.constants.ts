/**
 * How many runs in a row a conversation starts itself for finished work, with no user prompt
 * between them. A model that keeps starting background work would otherwise run unattended and
 * unbounded; past the cap the notices wait for the user's next prompt.
 */
export const MAX_CONSECUTIVE_WAKES = 10;

/**
 * After a run ended because the user queued a line, the conversation waits this long before it
 * wakes for finished work: the queued line normally arrives as the next prompt in that time and
 * delivers the notice itself. A line that is not a prompt (`/help`) leaves the notice to the wake.
 */
export const WAKE_AFTER_YIELD_MS = 1500;
