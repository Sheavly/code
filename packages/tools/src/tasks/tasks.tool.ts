import { z } from 'zod';
import type { TaskControl } from '@sheavly/runtime/tasks/task-scope.types';
import { formatTask, missingTaskMessage } from '@sheavly/runtime/tasks/tasks.utils';
import { now } from '@sheavly/core/clock/clock.helper';
import { requireTaskSession } from '@sheavly/core/tool/tool-session.helper';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import type { TaskId } from '@sheavly/protocol/task/task.types';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import { createAwaitTasksTool } from './await-tasks.tool.js';
import { controlOf } from './task-control.utils.js';
import type { TaskControlSource } from './tasks.types.js';
import { cancelTaskPrompts, taskStatusPrompts, taskStatusResponse } from './tasks.prompt.js';

/** The same answer for an unknown, a foreign and a released id: see `missingTaskMessage`. */
function missingTask(id: TaskId): ToolCallError {
  return new ToolCallError({ reason: 'not_found', message: missingTaskMessage(id) });
}

/** Lets the agent check on background tasks: one task (with output) or a list of all. */
function createTaskStatusTool(tasks: TaskControl) {
  return defineTool({
    name: 'task_status',
    description: taskStatusPrompts.description,
    inputSchema: z.object({
      id: taskIdSchema.optional().describe(taskStatusPrompts.id),
    }),
    execute: async ({ input: { id }, context }) => {
      // The registry is shared by the run's sessions: a session sees only its own tasks.
      const sessionId = requireTaskSession({ context, tool: 'task_status' });

      if (id) {
        const task = tasks.getOwned({ id, sessionId });

        if (!task) throw missingTask(id);

        return taskStatusResponse({
          content: formatTask({ task, now: now(), report: tasks.report(id, sessionId) }),
          running: task.status === 'running',
        });
      }

      const all = tasks.list(sessionId);

      if (all.length === 0) return 'No background tasks.';

      return taskStatusResponse({
        content: all.map((task) => formatTask({ task, now: now(), outputChars: 0 })).join('\n'),
        running: all.some((task) => task.status === 'running'),
      });
    },
  });
}

/** Lets the agent stop a background task; waits until its process has exited. */
function createCancelTaskTool(tasks: TaskControl) {
  return defineTool({
    name: 'cancel_task',
    description: cancelTaskPrompts.description,
    inputSchema: z.object({ id: taskIdSchema.describe(cancelTaskPrompts.id) }),
    execute: async ({ input: { id }, context }) => {
      const sessionId = requireTaskSession({ context, tool: 'cancel_task' });
      const before = tasks.getOwned({ id, sessionId });

      if (!before) throw missingTask(id);

      if (before.status !== 'running') {
        return `Task ${id} already ${before.status}.\n${formatTask({ task: before, now: now() })}`;
      }

      const after = await tasks.cancel({ id, sessionId });

      return `Cancelled task ${id}.\n${formatTask({ task: after ?? before, now: now() })}`;
    },
  });
}

/**
 * The tools for inspecting, grouping and stopping the background tasks of the calling session,
 * whatever started them: they act through a `TaskControl` (the `task:read-any` and
 * `task:cancel-any` grants), always for the session of the call. An app that holds the run's whole
 * `TaskRegistry` may pass it: it is read through the same calls (`controlOf`), so the tools never
 * ask the registry for more than a `TaskControl` gives.
 */
export function createTaskTools(source: TaskControlSource) {
  const tasks = controlOf(source);

  return [createTaskStatusTool(tasks), createCancelTaskTool(tasks), createAwaitTasksTool(tasks)];
}
