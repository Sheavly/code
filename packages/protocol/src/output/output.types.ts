import type { z } from 'zod';
import type { outputLogSchema, outputRefSchema, outputStatusSchema } from './output.validator.js';

export type OutputRef = z.infer<typeof outputRefSchema>;

export type OutputStatus = z.infer<typeof outputStatusSchema>;

export type OutputLog = z.infer<typeof outputLogSchema>;
