import type { TaskId } from '@sheavly/protocol/task/task.types';
import { TaskError } from '../errors/tasks.errors.js';

/** The error that keeps a task out of a new group, or undefined when it may join. */
export function groupMemberError(params: {
  id: TaskId;
  duplicate: boolean;
  grouped: boolean;
  service: boolean;
  owned: boolean;
}): TaskError | undefined {
  const { id, duplicate, grouped, service, owned } = params;

  if (duplicate) {
    return new TaskError({ reason: 'duplicate_task', taskId: id, message: `Duplicate task ${id}` });
  }

  if (grouped) {
    return new TaskError({
      reason: 'task_grouped',
      taskId: id,
      message: `Task ${id} already belongs to a group`,
    });
  }

  // Ownership first, so a foreign task's kind is not revealed by the error.
  if (!owned) {
    return new TaskError({
      reason: 'task_not_owned',
      taskId: id,
      message: `Task ${id} belongs to another session`,
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

  return undefined;
}
