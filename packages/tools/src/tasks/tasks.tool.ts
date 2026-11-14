import { z } from 'zod';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { formatTask, releasedTaskMessage } from '@sheavly/runtime/tasks/tasks.utils';
import { now } from '@sheavly/core/clock/clock.helper';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import type { TaskId } from '@sheavly/protocol/task/task.types';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import { createAwaitTasksTool } from './await-tasks.tool.js';
import { cancelTaskPrompts, taskStatusPrompts, taskStatusResponse } from './tasks.prompt.js';

/** A released task was reported and forgotten; any other missing id never existed. */
function missingTask(params: { tasks: TaskRegistry; id: TaskId }): ToolCallError {
  const { tasks, id } = params;

  return new ToolCallError({
    reason: 'not_found',
    message: tasks.isReleased(id) ? releasedTaskMessage(id) : `No task with id ${id}`,
  });
}

/** Lets the agent check on background tasks: one task (with output) or a list of all. */
function createTaskStatusTool(tasks: TaskRegistry) {
  return defineTool({
    name: 'task_status',
    description: taskStatusPrompts.description,
    inputSchema: z.object({
      id: taskIdSchema.optional().describe(taskStatusPrompts.id),
    }),
    execute: async ({ input: { id } }) => {
      if (id) {
        const task = tasks.get(id);

        if (!task) throw missingTask({ tasks, id });

        return taskStatusResponse({
          content: formatTask({ task, now: now(), report: tasks.report(id) }),
          running: task.status === 'running',
        });
      }

      const all = tasks.list();

      if (all.length === 0) return 'No background tasks.';

      return taskStatusResponse({
        content: all.map((task) => formatTask({ task, now: now(), outputChars: 0 })).join('\n'),
        running: all.some((task) => task.status === 'running'),
      });
    },
  });
}

/** Lets the agent stop a background task; waits until its process has exited. */
function createCancelTaskTool(tasks: TaskRegistry) {
  return defineTool({
    name: 'cancel_task',
    description: cancelTaskPrompts.description,
    inputSchema: z.object({ id: taskIdSchema.describe(cancelTaskPrompts.id) }),
    execute: async ({ input: { id } }) => {
      const before = tasks.get(id);

      if (!before) throw missingTask({ tasks, id });

      if (before.status !== 'running') {
        return `Task ${id} already ${before.status}.\n${formatTask({ task: before, now: now() })}`;
      }

      const after = await tasks.cancel(id);

      return `Cancelled task ${id}.\n${formatTask({ task: after ?? before, now: now() })}`;
    },
  });
}

/** The tools for inspecting, grouping and stopping background tasks on one shared registry. */
export function createTaskTools(tasks: TaskRegistry) {
  return [createTaskStatusTool(tasks), createCancelTaskTool(tasks), createAwaitTasksTool(tasks)];
}
