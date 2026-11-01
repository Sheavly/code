import { z } from 'zod';
import { runProcess } from '../../runtime/process/process.service.js';
import { defineTool } from '@sheavly/core/tool/tool.service';
import { DEFAULT_ALLOW_LIST } from './allow-list.constants.js';
import { DEFAULT_COMMAND_TIMEOUT_MS } from './run-command.constants.js';
import type { RunCommandOptions } from './run-command.types.js';
import { checkAllowed, formatResult } from './run-command.utils.js';

export function createRunCommandTool({
  workspace,
  allowList = DEFAULT_ALLOW_LIST,
  skipAllowList = false,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  tasks,
}: RunCommandOptions) {
  return defineTool({
    name: 'run_command',
    description:
      (skipAllowList
        ? 'Run a shell command in the workspace root.'
        : `Run a command in the workspace root. Only these are allowed: ${allowList.join(', ')}. ` +
          'No shell syntax (pipes, redirects, chaining).') +
      (tasks ? ' Set background: true for servers, watchers, or slow commands.' : ''),
    inputSchema: z.object({
      command: z.string().min(1).describe('The command to run, e.g. `git status`'),
      background: z
        .boolean()
        .optional()
        .describe(
          'Run in the background: returns a task id immediately, and you are notified when it exits. ' +
            'Check it with task_status, stop it with cancel_task.',
        ),
    }),
    execute: async ({ input: { command, background }, signal, context }) => {
      const [file, ...args] = skipAllowList ? [command] : checkAllowed({ command, allowList });
      const options = { file, args, cwd: workspace.root, shell: skipAllowList };

      if (background) {
        if (!tasks) throw new Error('Background commands are not enabled in this harness');
        // Not tied to `signal`: the task outlives this call (and this turn) until it exits or is cancelled.
        const task = tasks.start({
          command,
          description: context.description,
          callId: context.callId,
          run: ({ signal: taskSignal, onOutput }) =>
            runProcess({ ...options, signal: taskSignal, onOutput }),
        });

        return (
          `Started background task ${task.id}: $ ${command}\n` +
          "It keeps running; you'll be notified when it exits. Use task_status to see its output, cancel_task to stop it."
        );
      }

      const result = await runProcess({ ...options, timeoutMs, signal });

      return formatResult({ command, result });
    },
  });
}
