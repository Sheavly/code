/** Why a tool refused a call. */
type ToolCallFailure =
  /** A file or task the call names isn't there. */
  | 'not_found'
  /** The call can't be applied as given (an ambiguous or no-op edit). */
  | 'invalid_input'
  /** The call is outside what the agent may do (.env, .git, the allow list). */
  | 'forbidden'
  /** The harness wasn't set up for it (no session, no background tasks). */
  | 'unavailable';

/**
 * A tool refused a call. The message is written for the model: it says what was wrong and how
 * to fix the call (`runTool` turns it into an error result the model reads). `reason` lets a
 * hook or UI tell the cases apart without reading the message.
 */
export class ToolCallError extends Error {
  override name = 'ToolCallError';
  readonly reason: ToolCallFailure;

  constructor(params: { reason: ToolCallFailure; message: string }) {
    const { reason, message } = params;

    super(message);
    this.reason = reason;
  }
}
