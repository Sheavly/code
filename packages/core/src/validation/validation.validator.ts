import { z } from 'zod';
import type { Validation } from './validation.types.js';

/**
 * Validates `input` with `schema`. On failure, `details` is zod's readable summary of every issue
 * (`z.prettifyError`), for a message that tells the reader what to fix.
 */
export function validate<TSchema extends z.ZodType>(params: {
  schema: TSchema;
  input: unknown;
}): Validation<z.infer<TSchema>> {
  const parsed = params.schema.safeParse(params.input);

  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, details: z.prettifyError(parsed.error), error: parsed.error };
}

/**
 * Validates `input` with `schema` and returns the typed data, or throws what `onInvalid` builds
 * from zod's summary and the original error (keep it as `cause`). Each area passes its own typed
 * error, since core can't know them.
 */
export function parseOrThrow<TSchema extends z.ZodType>(params: {
  schema: TSchema;
  input: unknown;
  onInvalid: (failure: { details: string; error: z.ZodError }) => Error;
}): z.infer<TSchema> {
  const result = validate({ schema: params.schema, input: params.input });

  if (!result.success) throw params.onInvalid({ details: result.details, error: result.error });

  return result.data;
}
