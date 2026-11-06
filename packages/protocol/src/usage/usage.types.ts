import type { z } from 'zod';
import type { modelUsageSchema, tokenUsageSchema, usageTotalsSchema } from './usage.validator.js';

export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export type ModelUsage = z.infer<typeof modelUsageSchema>;
export type UsageTotals = z.infer<typeof usageTotalsSchema>;
