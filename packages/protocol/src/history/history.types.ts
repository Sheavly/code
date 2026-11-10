import type { z } from 'zod';
import type { historyMessageSchema } from './history.validator.js';

/** One entry of the stored conversation: a `Message`, or a checkpoint. */
export type HistoryMessage = z.infer<typeof historyMessageSchema>;
