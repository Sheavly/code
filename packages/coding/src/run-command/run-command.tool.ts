import { z } from 'zod';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { confirmCommand } from './command-approval.helper.js';
import { outsideGrantedFolder, resolveCommandCwd } from './command-cwd.helper.js';
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
      'Run a command in the workspace root (or in `cwd`: a folder of the workspace or of a sibling git worktree), without a shell. Chain commands with | && || and ;; ' +
      'redirects (> <), $variables, `backticks`, parentheses and & are not supported, and inside ' +
      "double quotes so is $ (use 'single quotes'; a backslash before other characters is literal, " +
      'so grep -E \'a\\|b\' src and grep -E "a\\|b" src both pass a\\|b). The user is asked before ' +
      'an unapproved base command runs. A session or workspace grant covers all its options and arguments, ' +
      'including paths outside the workspace, secret files, editing/execution options and npx downloads. ' +
      'Examples: find, sed, git diff, npm run test, npx eslint. Chained commands are approved independently. ' +
      'There is no shell glob expansion. If the user skips a command, do not run it again; do what they say.' +
      (tasks
        ? ' Set background: true for slow finite work; set backgroundKind: "service" for persistent servers or watchers. Do not poll background work.'
        : ''),
    inputSchema: z.object({
      command: z.string().min(1).describe('The command to run, e.g. `git status`'),
      cwd: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Folder to run in, absolute or relative to the workspace root (default: the root). ' +
            'It must be inside the workspace or a sibling git worktree of its repo.',
        ),
      background: z
        .boolean()
        .optional()
        .describe(
          'Return a task id immediately. Finite work keeps this prompt alive until its result is delivered. ' +
            'Finish independent work, then end your turn without tool calls to wait. Do not poll task_status.',
        ),
      backgroundKind: z
        .enum(['task', 'service'])
        .default('task')
        .describe(
          'With background: true, task is finite work (builds, tests, CI waits) whose result is required. ' +
            'Service is a persistent server or watcher that does not keep the prompt alive. Stop either with cancel_task.',
        ),
    }),
    execute: async ({ input: { command, cwd, background, backgroundKind }, signal, context }) => {
      const parsed = parseCommand(command);

      if (!parsed.ok) {
        throw new ToolCallError({
          reason: 'forbidden',
          message: `Command rejected (${parsed.reason}): ${command}`,
        });
      }

      // Before asking the user: a folder the sandbox refuses should not cost them an approval.
      const commandCwd = await resolveCommandCwd({ workspace, requested: cwd });

      await confirmCommand({
        command,
        steps: parsed.steps,
        permissions,
        approvals,
        call: { callId: context.callId, sessionId: context.session?.id },
        signal,
        outsideCwd: outsideGrantedFolder({ workspace, commandCwd }),
      });

      // Permission reads can finish after the loop has interrupted this call and cleaned up.
      // Check before detaching a task: its fresh controller must not outlive an aborted launch.
      signal.throwIfAborted();

      // The repo's git config can't make git run programs, whatever the command.
      const script = {
        steps: safeSteps(parsed.steps),
        cwd: commandCwd,
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
          backgroundKind,
          run: ({ signal: taskSignal, onOutput }) =>
            processes.runScript({ ...script, signal: taskSignal, onOutput }),
        });

        const started = `Started background task ${task.id}: $ ${command}\n`;

        if (backgroundKind === 'service') {
          return (
            started +
            'This service does not keep this prompt alive. Use task_status only to inspect readiness or diagnose a problem, not to wait for exit. Stop it with cancel_task when finished.'
          );
        }

        return (
          started +
          'This finite task keeps this prompt alive until its result is delivered automatically. Finish independent work, then end your turn without tool calls to wait. Do not poll task_status or repeat the command. Use cancel_task to stop it.'
        );
      }

      const result = await processes.runScript({ ...script, timeoutMs, signal });

      return formatResult({ command, result });
    },
  });
}
