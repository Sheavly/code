import { errorMessage } from '@sheavly/runtime/errors/errors.utils';

/**
 * The trust store exists but can't be read, parsed or written. Never treated as "nothing
 * trusted yet" silently: the message names the file, so the user can fix or delete it.
 */
export class TrustStoreError extends Error {
  override name = 'TrustStoreError';
  /** The store file, absolute. */
  readonly file: string;

  /** `reason` replaces the cause's message, e.g. a readable list of validation problems. */
  constructor(params: { file: string; cause: unknown; reason?: string }) {
    const { file, cause, reason = errorMessage(cause) } = params;

    super(`Workspace trust store ${file} could not be used: ${reason}`, { cause });
    this.file = file;
  }
}
