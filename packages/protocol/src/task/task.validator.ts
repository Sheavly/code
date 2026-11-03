import { z } from 'zod';
import { callIdSchema } from '../message/message.validator.js';

export const taskStatusSchema = z.enum(['running', 'completed', 'failed', 'cancelled']);

/**
 * A background task's id, unique within its registry. Branded, so it can't be passed where a
 * session's, tool call's or approval's id goes; it is still a plain string on the wire.
 */
export const taskIdSchema = z.string().brand<'TaskId'>();

/** A snapshot of a background task. Registry methods always return copies, never live objects. */
export const taskInfoSchema = z.object({
  id: taskIdSchema,
  /** The tool call that started it, so the loop can tie the launch to its call. */
  callId: callIdSchema.exactOptional(),
  command: z.string(),
  description: z.string(),
  status: taskStatusSchema,
  startedAt: z.number(),
  endedAt: z.number().exactOptional(),
  exitCode: z.number().int().nullable().exactOptional(),
  /** Combined stdout/stderr so far (the most recent part, if it was long). */
  output: z.string(),
  error: z.string().exactOptional(),
});
