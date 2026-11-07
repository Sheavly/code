/** A refused or failed fetch becomes an error tool result, never a failed agent run. */
export class WebFetchError extends Error {
  override name = 'WebFetchError';
}
