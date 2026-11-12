/** A tool result longer than this is cut when the span is shown to the model. */
export const MAX_TOOL_RESULT_CHARS = 2_000;

/** A tool call's input longer than this is cut when the span is shown to the model. */
export const MAX_TOOL_INPUT_CHARS = 500;

/** The line that opens or closes a fenced block of code in a reply. */
export const FENCE = '```';

/** A line longer than this is never a section heading, so it is not looked at as one. */
export const MAX_HEADING_LINE_CHARS = 200;

/**
 * The longest summary reply read: a reply past it is refused as the stream arrives, so a model that
 * never stops cannot fill memory. Far above any summary the output limit allows.
 */
export const MAX_REPLY_CHARS = 200_000;

/** A tool name is model-written, so a longer one is cut when the span is shown to the model. */
export const MAX_TOOL_NAME_CHARS = 80;
