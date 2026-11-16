import type { z } from 'zod';
import type {
  taskIdSchema,
  taskInfoSchema,
  taskKindSchema,
  taskStatusSchema,
  taskUpdateSchema,
} from './task.validator.js';

export type TaskKind = z.infer<typeof taskKindSchema>;

export type TaskId = z.infer<typeof taskIdSchema>;

export type TaskStatus = z.infer<typeof taskStatusSchema>;

export type TaskInfo = z.infer<typeof taskInfoSchema>;

/** A background task starting or ending. */
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;
