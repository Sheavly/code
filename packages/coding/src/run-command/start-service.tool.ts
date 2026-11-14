import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { commandServiceWork } from './command-work.utils.js';
import { prepareCommand, requireBackground, startCommandWork } from './command-launch.helper.js';
import type { RunCommandOptions } from './run-command.types.js';
import { backgroundStartedPrompt, runCommandPrompts } from './run-command.prompt.js';
import { startServicePrompts } from './start-service.prompt.js';
import { startedOutputLines } from './foreground.helper.js';

/**
 * `start_service`: a persistent server or watcher. It has run_command's checks and approval, and
 * the service kind fixes its policy, so it is never awaited or held open for. Needs a `TaskRegistry`.
 */
export function createStartServiceTool({
  workspace,
  workingRoots,
  permissions,
  tasks,
  approvals,
  outputs,
  processes,
}: RunCommandOptions) {
  const shared = runCommandPrompts({ backgroundEnabled: true });

  return defineTool({
    name: 'start_service',
    description: startServicePrompts({ outputsEnabled: Boolean(outputs) }).description,
    inputSchema: z.object({
      command: z.string().min(1).describe(shared.command),
      cwd: z.string().min(1).optional().describe(shared.cwd),
    }),
    execute: async ({ input: { command, cwd }, signal, context }) => {
      // Before the approval, so no one approves a command that could not start.
      const launch = requireBackground({ tasks, tool: 'start_service', context });
      const script = await prepareCommand({
        tool: 'start_service',
        command,
        cwd,
        options: { workspace, workingRoots, permissions, approvals },
        signal,
        context,
      });
      const { task, capture } = await startCommandWork({
        ...launch,
        toWork: commandServiceWork,
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
        backgroundKind: 'service',
        outputLines: startedOutputLines({ capture, log: task.outputLog }),
      });
    },
  });
}
