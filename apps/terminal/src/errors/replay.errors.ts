import { errorMessage } from '@sheavly/runtime/errors/errors.utils';

/**
 * What the user asked to replay has no stored stream: the folder isn't there, or holds neither a
 * conversation's `stream.jsonl` nor a run's `sessions.sse`. The message says where it looked.
 */
export class ReplayNotFoundError extends Error {
  override name = 'ReplayNotFoundError';
  /** The folder, as given. */
  readonly wanted: string;

  constructor(params: { wanted: string; message: string }) {
    super(params.message);
    this.wanted = params.wanted;
  }
}

/** Replay's output (stdout) failed for a reason other than its reader having gone away. */
export class ReplayOutputError extends Error {
  override name = 'ReplayOutputError';

  constructor(cause: unknown) {
    super(`Could not write the replay: ${errorMessage(cause)}`, { cause });
  }
}

/** The replay command line has an option it can't use; the message shows how to write it. */
export class ReplayOptionError extends Error {
  override name = 'ReplayOptionError';
}
