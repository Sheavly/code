import type { z } from 'zod';
import type { streamEntrySchema } from './stream.validator.js';

export type StreamEntry = z.infer<typeof streamEntrySchema>;
