import { z } from 'zod';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { currentRoot } from '../files/working-root.helper.js';
import { confirmCommand } from './command-approval.helper.js';
import { outsideGrantedFolder, resolveCommandCwd } from './command-cwd.helper.js';
import { parseCommand } from './allow-list.utils.js';
import { DEFAULT_COMMAND_TIMEOUT_MS } from './run-command.constants.js';
import type { RunCommandOptions } from './run-command.types.js';
import { safeGitEnv, safeSteps } from './run-command.utils.js';
import { backgroundStartedPrompt, runCommandPrompts } from './run-command.prompt.js';
import { closeCapture, startCapture } from './capture.helper.js';
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
      const parsed = parseCommand(command);

      if (!parsed.ok) {
        throw new ToolCallError({
          reason: 'forbidden',
          message: `Command rejected (${parsed.reason}): ${command}`,
        });
      }

      // Before asking the user: a folder the sandbox refuses should not cost them an approval.
      const root = await currentRoot(workingRoots);
      const commandCwd = await resolveCommandCwd({ workspace, requested: cwd, root });

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

        const capture = await startCapture(outputs);
        const writer = capture && 'writer' in capture ? capture.writer : undefined;
        let task;

        try {
          // An abort during the capture start must not detach a task from an interrupted call.
          signal.throwIfAborted();

          // Not tied to `signal`: the task outlives this call (and this turn) until it exits or is cancelled.
          task = tasks.start({
            command,
            description: context.description,
            callId: context.callId,
            sessionId: context.session?.id,
            backgroundKind,
            ...(writer && { capture: writer }),
            run: ({ signal: taskSignal, onOutput }) =>
              processes.runScript({ ...script, signal: taskSignal, onOutput }),
          });
        } catch (caughtError) {
          // No task owns the writer, so nothing else would close its file.
          if (writer) await closeCapture(writer);
          throw caughtError;
        }

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
