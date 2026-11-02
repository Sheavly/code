import type { z } from 'zod';

/** What `validate` returns: the typed data, or zod's readable summary and the original error. */
export type Validation<T> =
  { success: true; data: T } | { success: false; details: string; error: z.ZodError };
