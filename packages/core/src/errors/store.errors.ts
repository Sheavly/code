/** Why a store refused or failed an operation. */
type StoreFailure =
  /** `append` got an entry whose `seq` isn't the next one: something was lost or repeated. */
  | 'out_of_order'
  /** Storage itself failed (disk full, permissions, unreadable data); see `cause`. */
  | 'failed';

/**
 * A conversation store refused or failed an operation. A UI or host stops the conversation on
 * `failed` rather than carry on unrecorded; `cause` is the storage error behind it.
 */
export class StoreError extends Error {
  override name = 'StoreError';
  readonly reason: StoreFailure;

  constructor(params: { reason: StoreFailure; message: string; cause?: unknown }) {
    const { reason, message, cause } = params;

    super(message, { cause });
    this.reason = reason;
  }
}
