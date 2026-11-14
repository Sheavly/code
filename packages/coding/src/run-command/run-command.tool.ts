import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { commandTaskWork } from './command-work.utils.js';
import { prepareCommand, requireTasks, startCommandWork } from './command-launch.helper.js';
import { DEFAULT_COMMAND_TIMEOUT_MS } from './run-command.constants.js';
import type { RunCommandOptions } from './run-command.types.js';
import { backgroundStartedPrompt, runCommandPrompts } from './run-command.prompt.js';
import { runForeground, startedOutputLines } from './foreground.helper.js';

export function createRunCommandTool({
  workspace,
  workingRoots,
  permissions,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  tasks,
  approvals,
  outputs,
  processes,
}: RunCommandOptions) {
  const prompts = runCommandPrompts({
    backgroundEnabled: Boolean(tasks),
    outputsEnabled: Boolean(outputs),
  });

  return defineTool({
    name: 'run_command',
    description: prompts.description,
    inputSchema: z.object({
      command: z.string().min(1).describe(prompts.command),
      cwd: z.string().min(1).optional().describe(prompts.cwd),
      background: z.boolean().optional().describe(prompts.background),
    }),
    execute: async ({ input: { command, cwd, background }, signal, context }) => {
      // Before the approval, so no one approves a command that could not start.
      const registry = background ? requireTasks(tasks) : undefined;
      const script = await prepareCommand({
        tool: 'run_command',
        command,
        cwd,
        options: { workspace, workingRoots, permissions, approvals },
        signal,
        context,
      });

      if (registry) {
        const { task, capture } = await startCommandWork({
          tasks: registry,
          toWork: commandTaskWork,
          command,
          script,
          outputs,
          processes,
          signal,
          context,
        });

        return backgroundStartedPrompt({
          taskId: task.id,
          command,
          backgroundKind: 'task',
          outputLines: startedOutputLines({ capture, log: task.outputLog }),
        });
      }

      return runForeground({
        command,
        script: { ...script, timeoutMs, signal },
        processes,
        outputs,
      });
    },
  });
}
