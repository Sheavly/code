import type { z } from 'zod';
import type { taskIdSchema, taskInfoSchema, taskStatusSchema } from './task.validator.js';

export type TaskId = z.infer<typeof taskIdSchema>;

export type TaskStatus = z.infer<typeof taskStatusSchema>;

export type TaskInfo = z.infer<typeof taskInfoSchema>;
