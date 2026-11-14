import type { TaskId } from '@sheavly/protocol/task/task.types';
import { TaskError } from '../errors/tasks.errors.js';

/** The error that keeps a task out of a new group, or undefined when it may join. */
export function groupMemberError(params: {
  id: TaskId;
  duplicate: boolean;
  grouped: boolean;
  service: boolean;
  owned: boolean;
  delivered: boolean;
}): TaskError | undefined {
  const { id, duplicate, grouped, service, owned, delivered } = params;

  if (duplicate) {
    return new TaskError({ reason: 'duplicate_task', taskId: id, message: `Duplicate task ${id}` });
  }

  // Ownership before anything about the task itself, so a foreign task's group or kind is not
  // revealed by the error.
  if (!owned) {
    return new TaskError({
      reason: 'task_not_owned',
      taskId: id,
      message: `Task ${id} belongs to another session`,
    });
  }

  if (grouped) {
    return new TaskError({
      reason: 'task_grouped',
      taskId: id,
      message: `Task ${id} already belongs to a group`,
    });
  }

  // A service may outlive the run, so a group waiting on it might never be delivered.
  if (service) {
    return new TaskError({
      reason: 'service_task',
      taskId: id,
      message: `Task ${id} is a service and cannot be awaited in a group`,
    });
  }

  // Finished work reaches the model once, so a delivered notice cannot be asked for again.
  if (delivered) {
    return new TaskError({
      reason: 'task_delivered',
      taskId: id,
      message: `Task ${id} was already reported and cannot be grouped`,
    });
  }

  return undefined;
}
