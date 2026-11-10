import { z } from 'zod';
import { messageSchema, summaryMessageSchema } from '../message/message.validator.js';

/**
 * One entry of the stored conversation: what a model is sent, and the checkpoints. It sits above
 * `message/`, `session/` and `task/` because it aggregates them: an entry that carries session or
 * task data can import those without a cycle back into `message/`.
 */
export const historyMessageSchema = z.discriminatedUnion('role', [
  ...messageSchema.options,
  summaryMessageSchema,
]);
