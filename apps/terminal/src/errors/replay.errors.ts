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
