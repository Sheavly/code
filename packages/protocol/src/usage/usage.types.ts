import type { z } from 'zod';
import type {
  contextUsageSchema,
  modelUsageSchema,
  tokenUsageSchema,
  usageTotalsSchema,
} from './usage.validator.js';

export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export type ModelUsage = z.infer<typeof modelUsageSchema>;
export type UsageTotals = z.infer<typeof usageTotalsSchema>;
export type ContextUsage = z.infer<typeof contextUsageSchema>;
