/** Messages are safe for model-facing tool errors; raw transport failures belong only in cause. */
export class WebSearchError extends Error {
  override readonly name = 'WebSearchError';
}
