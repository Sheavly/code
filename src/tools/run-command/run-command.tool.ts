import { z } from 'zod';
import { runProcess } from '../../runtime/process/process.service.js';
import { defineTool } from '@sheavly/core/tool/tool.service';
import { DEFAULT_ALLOW_LIST } from './allow-list.constants.js';
import { confirmArguments } from './arguments.service.js';
import { DEFAULT_COMMAND_TIMEOUT_MS } from './run-command.constants.js';
import type { RunCommandOptions } from './run-command.types.js';
import { checkAllowed, formatResult, safeGitArgs, safeGitEnv } from './run-command.utils.js';
import { ToolCallError } from '../../runtime/errors/tools.errors.js';

export function createRunCommandTool({
  workspace,
  allowList = DEFAULT_ALLOW_LIST,
  skipAllowList = false,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  tasks,
  approvals,
}: RunCommandOptions) {
  return defineTool({
    name: 'run_command',
    description:
      (skipAllowList
        ? 'Run a shell command in the workspace root.'
        : `Run a command in the workspace root. Only these are allowed: ${allowList.join(', ')}. ` +
          'No shell syntax (pipes, redirects, chaining). The user must approve commands whose ' +
          'arguments reach outside the workspace, name .env files or use globs, and git ' +
          'commands that can print file contents (git diff, git log -p, git show); prefer ' +
          'git status -sb, git log --oneline and git diff --stat.') +
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

      // The allow list is the first gate; risky arguments of an allowed command are the user's call.
      if (!skipAllowList) {
        await confirmArguments({
          workspace,
          command,
          file,
          args,
          approvals,
          call: { callId: context.callId, sessionId: context.session?.id },
          signal,
        });
      }

      // The repo's git config can't make git run programs, whatever the command.
      const options = {
        file,
        args: safeGitArgs({ file, args }),
        cwd: workspace.root,
        shell: skipAllowList,
        env: safeGitEnv(),
      };

      if (background) {
        if (!tasks) {
          throw new ToolCallError({
            reason: 'unavailable',
            message: 'Background commands are not enabled in this harness',
          });
        }

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
