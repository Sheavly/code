import type { TaskId } from '@sheavly/protocol/task/task.types';

/** Why a task group was refused. */
type TaskFailure =
  | 'empty_group'
  | 'unknown_task'
  | 'duplicate_task'
  | 'task_grouped'
  | 'task_not_owned'
  | 'service_task'
  | 'task_delivered';

/** A group request was refused without changing any task or delivery. */
export class TaskError extends Error {
  override name = 'TaskError';
  readonly reason: TaskFailure;
  readonly taskId?: TaskId;

  constructor(params: { reason: TaskFailure; taskId?: TaskId; message: string }) {
    super(params.message);
    this.reason = params.reason;
    if (params.taskId !== undefined) this.taskId = params.taskId;
  }
}
