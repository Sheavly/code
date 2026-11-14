import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { commandWork } from './command-work.utils.js';
import { prepareCommand, startCommandWork } from './command-launch.helper.js';
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
      backgroundKind: z.enum(['task', 'service']).default('task').describe(prompts.backgroundKind),
    }),
    execute: async ({ input: { command, cwd, background, backgroundKind }, signal, context }) => {
      const script = await prepareCommand({
        command,
        cwd,
        options: { workspace, workingRoots, permissions, approvals },
        signal,
        context,
      });

      if (background) {
        const { task, capture } = await startCommandWork({
          tasks,
          toWork: (workInput) => commandWork({ kind: backgroundKind, input: workInput }),
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
          backgroundKind,
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
