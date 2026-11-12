/** Why stored command output could not be used. */
type OutputFailure =
  /** No such log in this conversation: never captured, deleted, or belonging to another conversation. */
  | 'not_found'
  /** Storage failed, or the capture could not be started; see `cause`. */
  | 'unavailable'
  /** The offset, size or query asked for cannot be applied. */
  | 'invalid_range'
  /** The conversation already holds as much stored output as it may; this command's is not kept. */
  | 'quota_exceeded';

/**
 * Stored command output could not be created, read or searched. The message is written for the
 * model: it says what to do next. A partial log is never returned as if it were whole.
 */
export class OutputError extends Error {
  override name = 'OutputError';
  readonly reason: OutputFailure;

  constructor(params: { reason: OutputFailure; message: string; cause?: unknown }) {
    const { reason, message, cause } = params;

    super(message, { cause });
    this.reason = reason;
  }
}
