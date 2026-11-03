// Errors `run_command` throws. It moves with the tool into the coding package (#29).

/** Why a command was refused instead of run. */
type CommandRefusedReason = 'needs_approval' | 'skipped';

/**
 * An allow-listed command was not run: it needs the user's approval and nobody can give it
 * (`needs_approval`), or the user skipped it (`skipped`). The message is what the model reads.
 */
export class CommandRefusedError extends Error {
  override name = 'CommandRefusedError';
  readonly reason: CommandRefusedReason;
  readonly command: string;

  constructor(params: { reason: CommandRefusedReason; command: string; message: string }) {
    const { reason, command, message } = params;

    super(message);
    this.reason = reason;
    this.command = command;
  }
}
