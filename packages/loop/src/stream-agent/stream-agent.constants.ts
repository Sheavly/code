/** The result of a tool the user interrupted before it finished. */
export const INTERRUPTED_BY_USER = 'Interrupted by the user before this tool finished.';

/**
 * Output-limit recoveries in a row that may keep no text and no tool call before the run ends
 * `max_tokens`: a reply that is cut off before saying anything would otherwise repeat forever.
 */
export const MAX_FRUITLESS_CONTINUATIONS = 3;

/** The completion reason of a report written when a conversation was reopened, not when it ended. */
export const RESTORED_REPORT_REASON = 'The conversation was reopened after this sub-agent ended.';

/** The result of a tool stopped because the model call that asked for it failed. */
export const STOPPED_BY_FAILURE = 'Stopped before this tool finished: the model call failed.';
