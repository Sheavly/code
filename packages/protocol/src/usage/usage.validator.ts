import { z } from 'zod';
import { contextWindowSchema, modelIdSchema } from '../model/model.validator.js';

const count = z.number().int().nonnegative();
const dollars = z.number().nonnegative();

/** Input includes cache reads and writes; output includes reasoning tokens when the API does. */
export const tokenUsageSchema = z
  .object({
    inputTokens: count,
    outputTokens: count,
    cacheReadTokens: count,
    cacheWriteTokens: count,
  })
  .refine((usage) => usage.inputTokens >= usage.cacheReadTokens + usage.cacheWriteTokens);

/**
 * One model call. Null tokens mean the provider did not report usage, never zero usage. The
 * window is the size of the context the call ran against, left out when the model's is unknown.
 */
export const modelUsageSchema = z.object({
  tokens: tokenUsageSchema.nullable(),
  modelId: modelIdSchema.exactOptional(),
  contextWindow: contextWindowSchema.exactOptional(),
  estimatedCostUsd: dollars.exactOptional(),
});

export const usageTotalsSchema = z.object({
  throughSeq: z.number().int().min(-1),
  calls: count,
  inputTokens: count,
  outputTokens: count,
  cacheReadTokens: count,
  cacheWriteTokens: count,
  estimatedCostUsd: dollars,
  missingUsageCalls: count,
  unpricedCalls: count,
  incomplete: z.boolean(),
});
