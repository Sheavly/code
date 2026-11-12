import { OutputError } from '@sheavly/core/errors/output.errors';

/** The error for a reference this conversation does not have, whoever made the reference. */
export function notFound(ref: string): OutputError {
  return new OutputError({
    reason: 'not_found',
    message: `No stored output ${ref} in this conversation. It may never have existed, or belong to another conversation.`,
  });
}

/** Storage failed. The cause may name a path, so it stays on `cause` and never in the message. */
export function unavailable(cause: unknown): OutputError {
  return new OutputError({
    reason: 'unavailable',
    message:
      'Stored command output is unavailable: storage failed. Rerun the command only if it is safe to.',
    cause,
  });
}

/** The conversation was deleted, so nothing more is stored for it. */
export function deleted(): OutputError {
  return new OutputError({
    reason: 'unavailable',
    message: 'Stored command output is unavailable: this conversation was deleted.',
  });
}

export function tooManyLogs(maxLogs: number): OutputError {
  return new OutputError({
    reason: 'quota_exceeded',
    message: `This conversation already stores ${String(maxLogs)} command outputs, the most it keeps.`,
  });
}
