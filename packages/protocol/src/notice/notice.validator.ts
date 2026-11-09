import { z } from 'zod';
import { contextWindowSchema } from '../model/model.validator.js';
import { tokenUsageSchema } from '../usage/usage.validator.js';

const contextStateSchema = z.union([
  z.object({
    window: contextWindowSchema,
    used: tokenUsageSchema.shape.inputTokens.optional(),
  }),
  z.object({
    window: z.never().optional(),
    used: tokenUsageSchema.shape.inputTokens,
  }),
]);

/** Harness-originated data shared by the model and UI, without model instructions or UI styling. */
export const harnessNoticeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('context-usage'), context: contextStateSchema }),
]);
