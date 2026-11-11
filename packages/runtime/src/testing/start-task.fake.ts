import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { TaskRegistry } from '../tasks/tasks.service.js';

/**
 * Test-only tool: `start_task` starts a background task that prints `output` and exits with
 * `exitCode` after `ms`, or stops early when cancelled. What a background command looks like to
 * the loop and the task tools, without a workspace or a process.
 */
export function startTaskTool(tasks: TaskRegistry) {
  return defineTool({
    name: 'start_task',
    description: 'Start a background task',
    inputSchema: z.object({
      ms: z.number(),
      output: z.string().default(''),
      exitCode: z.number().default(0),
      backgroundKind: z.enum(['task', 'service']).default('task'),
    }),
    execute: async ({ input: { ms, output, exitCode, backgroundKind }, context }) => {
      const task = tasks.start({
        command: `wait ${ms}ms`,
        description: context.description,
        callId: context.callId,
        sessionId: context.session?.id,
        backgroundKind,
        run: ({ signal, onOutput }) =>
          new Promise((resolve) => {
            const timer = setTimeout(() => {
              onOutput(output);
              resolve({ exitCode });
            }, ms);

            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              resolve({ exitCode: null });
            });
          }),
      });

      return `Started background task ${task.id}`;
    },
  });
}
