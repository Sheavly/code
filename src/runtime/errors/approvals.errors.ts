import { errorMessage } from './errors.utils.js';
import type { ApprovalUpdate } from '../approvals/approvals.types.js';

/**
 * A subscriber threw while hearing an update. Every other listener still hears it; then this
 * reaches whoever caused the update (the waiting request, or the UI that called `respond`).
 */
export class ApprovalListenerError extends Error {
  override name = 'ApprovalListenerError';
  /** The update the listener failed on. */
  readonly update: ApprovalUpdate['type'];

  constructor(params: { update: ApprovalUpdate['type']; cause: unknown }) {
    const { update, cause } = params;

    super(`An approval listener failed on ${update}: ${errorMessage(cause)}`, { cause });
    this.update = update;
  }
}

/** Why an approval couldn't be asked for or answered. */
type ApprovalRequestReason = 'no_listener' | 'unknown_id';

/**
 * An approval can't go ahead: nobody is listening to ask (`no_listener`, so the call fails
 * closed), or an answer names a request that isn't waiting (`unknown_id`).
 */
export class ApprovalRequestError extends Error {
  override name = 'ApprovalRequestError';
  readonly reason: ApprovalRequestReason;

  constructor(params: { reason: ApprovalRequestReason; message: string }) {
    const { reason, message } = params;

    super(message);
    this.reason = reason;
  }
}

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
