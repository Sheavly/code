import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';

/** A bounded transient task snapshot shared by protocol serialization tests. */
export const RUNNING_TASKS_NOTICE: Extract<HarnessNotice, { kind: 'running-tasks' }> = {
  kind: 'running-tasks',
  tasks: [
    {
      id: taskIdSchema.parse('task-first'),
      title: 'Check <providers>',
      reason: 'Need the regression results before finishing.',
      startedAt: 1_800_000_000_000,
      group: taskIdSchema.parse('task-first'),
    },
    {
      id: taskIdSchema.parse('task-second'),
      title: 'Review docs',
      reason: 'Confirm the thinking replay tradeoff.',
      startedAt: 1_800_000_000_100,
      group: taskIdSchema.parse('task-first'),
    },
  ],
  total: 3,
  omitted: 1,
};
