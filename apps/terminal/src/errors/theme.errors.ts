/** The theme a user asked for does not exist. */
export class ThemeError extends Error {
  override name = 'ThemeError';

  constructor(params: { message: string; cause?: unknown }) {
    const { message, cause } = params;

    super(message, cause === undefined ? undefined : { cause });
  }
}
