import { z } from 'zod';
import { callIdSchema } from '../message/message.validator.js';
import { outputLogSchema } from '../output/output.validator.js';
import { timestampSchema } from '../time/time.validator.js';

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
  /** Explicit await_tasks reason, absent until the task joins a delivery group. */
  reason: z.string().exactOptional(),
  status: taskStatusSchema,
  startedAt: timestampSchema,
  endedAt: timestampSchema.exactOptional(),
  exitCode: z.number().int().nullable().exactOptional(),
  /** Combined stdout/stderr so far (the most recent part, if it was long). */
  output: z.string(),
  /** Where the complete output is kept, when it is captured: `output` stays a bounded preview. */
  outputLog: outputLogSchema.exactOptional(),
  error: z.string().exactOptional(),
});

/**
 * A background task starting or ending, as a UI follows it: its snapshot then (`task_ended`
 * carries its status, exit code and the end of its output).
 */
export const taskUpdateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('task_started'), task: taskInfoSchema }),
  z.object({ type: z.literal('task_ended'), task: taskInfoSchema }),
]);
