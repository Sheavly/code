import type { z } from 'zod';
import type { diagnosticRecordSchema } from './diagnostic-record.validator.js';

export type DiagnosticRecord = z.infer<typeof diagnosticRecordSchema>;
