import { z } from 'zod';
import { requireTaskSession } from '@sheavly/core/tool/tool-session.helper';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import type { TaskControl } from '@sheavly/runtime/tasks/task-scope.types';
import { awaitTasksPrompts, groupedTasksPrompt } from './await-tasks.prompt.js';

/** Registers a completion group immediately; the registry holds notices until all members settle. */
export function createAwaitTasksTool(tasks: TaskControl) {
  return defineTool({
    name: 'await_tasks',
    description: awaitTasksPrompts.description,
    inputSchema: z.object({
      ids: z.array(taskIdSchema).min(1).describe(awaitTasksPrompts.ids),
      reason: z.string().trim().min(1).describe(awaitTasksPrompts.reason),
    }),
    execute: async ({ input: { ids, reason }, context }) => {
      tasks.group({ ids, reason, sessionId: requireTaskSession({ context, tool: 'await_tasks' }) });

      return groupedTasksPrompt({ ids, reason });
    },
  });
}
