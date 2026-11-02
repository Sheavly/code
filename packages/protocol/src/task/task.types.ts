import type { z } from 'zod';
import type { taskInfoSchema, taskStatusSchema } from './task.validator.js';

export type TaskStatus = z.infer<typeof taskStatusSchema>;

export type TaskInfo = z.infer<typeof taskInfoSchema>;
