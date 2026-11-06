/**
 * Why a setup call was refused: the profile or model it names isn't there, what was sent is not
 * acceptable (a model its adapter would reject, a secret its adapter doesn't have), or the backend
 * won't take it here (a key over a network it is not safe on). The message says what to change,
 * and never quotes a value that was sent.
 */
type SetupFailure = 'not_found' | 'invalid' | 'forbidden';

export class SetupError extends Error {
  override name = 'SetupError';
  readonly reason: SetupFailure;

  constructor(params: { reason: SetupFailure; message: string; cause?: unknown }) {
    const { reason, message, cause } = params;

    super(message, { cause });
    this.reason = reason;
  }
}
