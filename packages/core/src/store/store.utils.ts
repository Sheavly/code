import { StoreError } from '../errors/store.errors.js';

/**
 * A storage error as a `StoreError`: one a store already raised is kept as it is, any other is
 * wrapped with `message` and kept as its `cause`.
 */
export function toStoreError(params: { error: unknown; message: string }): StoreError {
  const { error, message } = params;

  return error instanceof StoreError
    ? error
    : new StoreError({ reason: 'failed', message, cause: error });
}
