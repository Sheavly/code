import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';

/** Registers a completion group immediately; the registry holds notices until all members settle. */
export function createAwaitTasksTool(tasks: TaskRegistry) {
  return defineTool({
    name: 'await_tasks',
    description:
      'Group background tasks so their results arrive together after every member finishes. ' +
      'Returns immediately; it does not block this call or poll. Finish independent work, then end your turn without tool calls to wait. ' +
      'Give your future self enough context to use the results after a summary: explain what decision or next step depends on them. ' +
      'Do not use a generic reason such as "waiting for results". Inspect task_status only for requested updates or diagnosis.',
    inputSchema: z.object({
      ids: z
        .array(taskIdSchema)
        .min(1)
        .describe('Task ids to group; each must exist and not already belong to a group.'),
      reason: z
        .string()
        .trim()
        .min(1)
        .describe(
          'Required context for your future self after a summary: why these results belong together and what to do with them. ' +
            'Explain the dependent decision or next step, not merely "waiting for results".',
        ),
    }),
    execute: async ({ input: { ids, reason }, context }) => {
      tasks.group({ ids, reason, ...(context.session && { sessionId: context.session.id }) });

      return (
        `Grouped tasks ${ids.join(', ')}. Their results will be delivered together when all members finish.\n` +
        `Reason: ${reason}\n` +
        'Finish independent work, then end your turn without tool calls to wait. Do not poll task_status.'
      );
    },
  });
}
