import type { Message, ToolCall } from '@sheavly/protocol/message/message.types';

/**
 * A section a rule writes, with no model: from the span being summarized and the same section's
 * text in the previous checkpoint, it returns the section's new text. It merges the old text
 * with what is new rather than starting over, and returns an empty string when it has nothing to
 * say (the section is then left out).
 */
export type RuleSection = {
  /** Stable across checkpoints, so a UI can pick the section out by it. */
  id: string;
  title: string;
  write(input: { messages: readonly Message[]; previous: string | undefined }): string;
};

/**
 * Turns one tool call into a short line for the file trail, or nothing when the call says
 * nothing worth keeping. Generic code never learns what a file is: the app that knows its tools
 * supplies this.
 */
export type TrailExtractor = (call: ToolCall) => string | undefined;
