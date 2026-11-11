import type { z } from 'zod';
import type { harnessNoticeSchema, taskCompletionContextSchema } from './notice.validator.js';

/** Completion-time context retained as a snapshot, not recomputed when history is replayed. */
export type TaskCompletionContext = z.infer<typeof taskCompletionContextSchema>;

/** Notice data that UIs receive as structured protocol data, and that a model may be shown. */
export type HarnessNotice = z.infer<typeof harnessNoticeSchema>;
