import { z } from 'zod';
import {
  messageSchema,
  messageTimeSchema,
  summaryMessageSchema,
} from '../message/message.validator.js';
import { persistentNoticeSchema } from '../notice/notice.validator.js';

/**
 * A harness notice kept in history. A model is sent it as text from the core formatter, never as a
 * person's prompt, so it carries no `id`; a UI reads `notice` and decides how to show it.
 */
export const noticeMessageSchema = z.object({
  role: z.literal('notice'),
  notice: persistentNoticeSchema,
  at: messageTimeSchema,
});

/**
 * One entry of the stored conversation: what a model is sent, the checkpoints, and the notices. It
 * sits above `message/`, `session/` and `task/` because it aggregates them: an entry that carries
 * session or task data can import those without a cycle back into `message/`.
 */
export const historyMessageSchema = z.discriminatedUnion('role', [
  ...messageSchema.options,
  summaryMessageSchema,
  noticeMessageSchema,
]);

/**
 * The history a client may start a conversation from: everything but notices. A notice is written
 * by the harness alone, so a request cannot carry one and gain the harness's framing.
 */
export const clientHistoryMessageSchema = z.discriminatedUnion('role', [
  ...messageSchema.options,
  summaryMessageSchema,
]);
