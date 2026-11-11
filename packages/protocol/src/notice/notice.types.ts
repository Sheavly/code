import type { z } from 'zod';
import type {
  harnessNoticeSchema,
  runningTaskSchema,
  runningTasksNoticeSchema,
  taskCompletionContextSchema,
} from './notice.validator.js';

/** One bounded task summary; its reason is agent-authored data. */
export type RunningTask = z.infer<typeof runningTaskSchema>;

/** Live snapshot for one model call, never persistent history. */
export type RunningTasksNotice = z.infer<typeof runningTasksNoticeSchema>;

/** Completion-time context retained as a snapshot, not recomputed when history is replayed. */
export type TaskCompletionContext = z.infer<typeof taskCompletionContextSchema>;

/** Notice data that UIs receive as structured protocol data, and that a model may be shown. */
export type HarnessNotice = z.infer<typeof harnessNoticeSchema>;
