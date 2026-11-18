import type { TaskControl } from '@sheavly/runtime/tasks/task-scope.types';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';

/**
 * What the task tools act on: a `TaskControl`, which asks for a session on every call, or the
 * run's whole `TaskRegistry` for an app that holds it, read through the same calls (`controlOf`).
 */
export type TaskControlSource = TaskControl | TaskRegistry;
