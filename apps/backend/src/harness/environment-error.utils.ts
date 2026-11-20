import { TrustStoreError } from '@sheavly/coding/errors/trust.errors';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';

/**
 * Whether `caughtError` is the environment failing (a system error such as `EACCES` or `ENOENT`)
 * and not the program: Node's argument-validation errors carry a string `code` too (`ERR_…`) and
 * are bugs, so they are not matched. The pattern is not a constant of the harness folder: every
 * constants file there is hashed into the system prompt review.
 */
function isSystemError(caughtError: unknown): boolean {
  const code = errorCode(caughtError);

  return code !== undefined && /^E[A-Z0-9]+$/.test(code) && !code.startsWith('ERR_');
}

/**
 * Whether `caughtError` is a failure a hostile or damaged folder can cause in the trust step: a
 * `TrustStoreError` or a system error. Anything else is a bug and must be rethrown.
 */
export function isEnvironmentError(caughtError: unknown): boolean {
  return caughtError instanceof TrustStoreError || isSystemError(caughtError);
}
