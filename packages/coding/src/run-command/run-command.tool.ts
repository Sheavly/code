import { z } from 'zod';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { confirmCommand } from './command-approval.helper.js';
import { parseCommand } from './allow-list.utils.js';
import { DEFAULT_COMMAND_TIMEOUT_MS } from './run-command.constants.js';
import type { RunCommandOptions } from './run-command.types.js';
import { formatResult, safeGitEnv, safeSteps } from './run-command.utils.js';

export function createRunCommandTool({
  workspace,
  permissions,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  tasks,
  approvals,
  processes,
}: RunCommandOptions) {
  return defineTool({
    name: 'run_command',
    description:
      'Run a command in the workspace root, without a shell. Chain commands with | && || and ;; ' +
      'redirects (> <), $variables, `backticks`, parentheses and & are not supported, and inside ' +
      "double quotes so is $ (use 'single quotes'; a backslash before other characters is literal, " +
      'so grep -E \'a\\|b\' src and grep -E "a\\|b" src both pass a\\|b). The user is asked before ' +
      'a command they have not allowed yet runs, before one whose arguments reach outside the ' +
      'workspace, name .env files or use globs, and before git commands that can print file ' +
      'contents (git diff, git log -p, git show); prefer git status -sb, git log --oneline and ' +
      'git diff --stat. If the user skips a command, do not run it again; do what they say.' +
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
      const parsed = parseCommand(command);

      if (!parsed.ok) {
        throw new ToolCallError({
          reason: 'forbidden',
          message: `Command rejected (${parsed.reason}): ${command}`,
        });
      }

      await confirmCommand({
        workspace,
        command,
        steps: parsed.steps,
        permissions,
        approvals,
        call: { callId: context.callId, sessionId: context.session?.id },
        signal,
      });

      // The repo's git config can't make git run programs, whatever the command.
      const script = {
        steps: safeSteps(parsed.steps),
        cwd: workspace.root,
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
          sessionId: context.session?.id,
          run: ({ signal: taskSignal, onOutput }) =>
            processes.runScript({ ...script, signal: taskSignal, onOutput }),
        });

        return (
          `Started background task ${task.id}: $ ${command}\n` +
          "It keeps running; you'll be notified when it exits. Use task_status to see its output, cancel_task to stop it."
        );
      }

      const result = await processes.runScript({ ...script, timeoutMs, signal });

      return formatResult({ command, result });
    },
  });
}
