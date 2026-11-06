/** Why the registry refused an operation. */
type RegistryFailure =
  /** No profile has this id (it was never made, or it was deleted). */
  | 'unknown_profile'
  /** No model of the profile has this id, so a key for it would belong to nothing. */
  | 'unknown_model';

/**
 * The profile registry refused an operation because what it names isn't there. A UI turns it into
 * "not found"; it is never a storage failure, which is a `StorageFileError`.
 */
export class RegistryError extends Error {
  override name = 'RegistryError';
  readonly reason: RegistryFailure;

  constructor(params: { reason: RegistryFailure; message: string }) {
    super(params.message);
    this.reason = params.reason;
  }
}
