/**
 * The most lines of a failure `/errors <n>` shows: the start, where a command says what it ran,
 * and the end, where it says what went wrong. Lines between are counted, not drawn.
 */
export const FAILURE_HEAD_LINES = 30;
export const FAILURE_TAIL_LINES = 70;

/** What `/errors` says before any step has failed with more to say. */
export const NO_FAILURES_TEXT = 'No failed steps with more to say in this chat yet.';
