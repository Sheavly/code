import { z } from 'zod';

export const taskStatusSchema = z.enum(['running', 'completed', 'failed', 'cancelled']);

/** A snapshot of a background task. Registry methods always return copies, never live objects. */
export const taskInfoSchema = z.object({
  id: z.string(),
  /** The tool call that started it, so the loop can tie the launch to its call. */
  callId: z.string().exactOptional(),
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
