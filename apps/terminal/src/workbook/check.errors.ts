/** A check cannot safely establish or retain its isolated approval connection. */
export class WorkbookCheckError extends Error {
  override name = 'WorkbookCheckError';

  constructor(params: { message: string; cause?: unknown }) {
    super(params.message, params.cause === undefined ? undefined : { cause: params.cause });
  }
}
