import type { z } from 'zod';
import type { clientHistoryMessageSchema, historyMessageSchema } from './history.validator.js';

/** One entry of the stored conversation: a `Message`, a checkpoint, or a notice. */
export type HistoryMessage = z.infer<typeof historyMessageSchema>;

/** An entry a client may start a conversation from: any but a notice. */
export type ClientHistoryMessage = z.infer<typeof clientHistoryMessageSchema>;
