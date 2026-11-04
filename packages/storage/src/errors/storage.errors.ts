import { errorMessage } from '@sheavly/runtime/errors/errors.utils';

/**
 * A file under the user's folder exists but can't be read, parsed, validated or written. Never
 * treated as "nothing stored" silently: the message names the file, so the user can fix or delete
 * it. `cause` is the error behind it.
 */
export class StorageFileError extends Error {
  override name = 'StorageFileError';
  /** The file, absolute. */
  readonly file: string;

  /** `reason` replaces the cause's message, e.g. a readable list of validation problems. */
  constructor(params: { file: string; cause: unknown; reason?: string }) {
    const { file, cause, reason = errorMessage(cause) } = params;

    super(`Stored file ${file} could not be used: ${reason}`, { cause });
    this.file = file;
  }
}

/**
 * A folder or file was refused for deletion because it is not one a store makes: it is not named
 * by an id the way a store names its own, or it is the home folder or a filesystem root. It is a
 * bug in the caller, never bad data on disk, so nothing was touched.
 */
export class UnsafeRemovalError extends Error {
  override name = 'UnsafeRemovalError';
  /** The folder or file that was asked for, as given. */
  readonly target: string;

  constructor(params: { target: string; reason: string }) {
    super(`Refusing to remove ${params.target}: ${params.reason}`);
    this.target = params.target;
  }
}
