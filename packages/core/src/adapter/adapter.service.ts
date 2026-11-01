import type { z } from 'zod';
import type { Adapter } from './adapter.types.js';

/** Identity helper: lets TypeScript infer `config` from the schema. */
export function defineAdapter<TSchema extends z.ZodType>(
  adapter: Adapter<TSchema>,
): Adapter<TSchema> {
  return adapter;
}
