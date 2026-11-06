/** The result of a tool the user interrupted before it finished. */
export const INTERRUPTED_BY_USER = 'Interrupted by the user before this tool finished.';

/** The result of a tool stopped because the model call that asked for it failed. */
export const STOPPED_BY_FAILURE = 'Stopped before this tool finished: the model call failed.';

/** A new user turn, not assistant prefilling, which adaptive thinking models do not support. */
export const OUTPUT_CONTINUATION_INSTRUCTION =
  'Your previous response reached the output-token limit before finishing. Continue from where it stopped without repeating completed text or tool actions. Finish the original request.';
