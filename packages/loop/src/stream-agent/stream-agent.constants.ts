/** Model calls per run before it stops with reason `max_turns`. */
export const DEFAULT_MAX_TURNS = 20;

/** The result of a tool the user interrupted before it finished. */
export const INTERRUPTED_BY_USER = 'Interrupted by the user before this tool finished.';

/** The result of a tool stopped because the model call that asked for it failed. */
export const STOPPED_BY_FAILURE = 'Stopped before this tool finished: the model call failed.';
