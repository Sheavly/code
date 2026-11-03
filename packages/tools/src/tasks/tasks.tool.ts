import { z } from 'zod';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { formatTask } from '@sheavly/runtime/tasks/tasks.utils';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';

/** Lets the agent check on background tasks: one task (with output) or a list of all. */
function createTaskStatusTool(tasks: TaskRegistry) {
  return defineTool({
    name: 'task_status',
    description:
      "Show background tasks. With an id: that task's status and recent output. Without: all tasks. " +
      "You don't need it to wait for a task: finished tasks are reported to you automatically.",
    inputSchema: z.object({
      id: taskIdSchema.optional().describe('Task id, e.g. t1. Omit to list all tasks.'),
    }),
    execute: async ({ input: { id } }) => {
      if (id) {
        const task = tasks.get(id);

        if (!task) {
          throw new ToolCallError({
            reason: 'not_found',
            message: `No task with id ${id}`,
          });
        }

        return formatTask({ task });
      }

      const all = tasks.list();

      if (all.length === 0) return 'No background tasks.';

      return all.map((task) => formatTask({ task, outputChars: 0 })).join('\n');
    },
  });
}

/** Lets the agent stop a background task; waits until its process has exited. */
function createCancelTaskTool(tasks: TaskRegistry) {
  return defineTool({
    name: 'cancel_task',
    description: 'Stop a running background task (kills its process and everything it started).',
    inputSchema: z.object({ id: taskIdSchema.describe('Task id, e.g. t1') }),
    execute: async ({ input: { id } }) => {
      const before = tasks.get(id);

      if (!before) {
        throw new ToolCallError({
          reason: 'not_found',
          message: `No task with id ${id}`,
        });
      }

      if (before.status !== 'running') {
        return `Task ${id} already ${before.status}.\n${formatTask({ task: before })}`;
      }

      const after = await tasks.cancel(id);

      return `Cancelled task ${id}.\n${formatTask({ task: after ?? before })}`;
    },
  });
}

/** The tools for checking on and stopping background tasks, sharing one registry with run_command. */
export function createTaskTools(tasks: TaskRegistry) {
  return [createTaskStatusTool(tasks), createCancelTaskTool(tasks)];
}
