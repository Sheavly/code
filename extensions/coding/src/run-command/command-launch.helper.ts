import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { requireTaskSession } from '@sheavly/core/tool/tool-session.helper';
import type { ToolContext } from '@sheavly/core/tool/tool.types';
import type { OutputCapture } from '@sheavly/core/output/output.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { TaskStarter } from '@sheavly/runtime/tasks/task-scope.types';
import type { WorkDefinition, WorkInput } from '@sheavly/runtime/tasks/work.types';
import { startWork } from '@sheavly/runtime/tasks/work.utils';
import type { ProcessRunner } from '@sheavly/process/process/process.service';
import type { ScriptParams } from '@sheavly/process/process/process.types';
import { currentRoot } from '../files/working-root.helper.js';
import { parseCommand } from './allow-list.utils.js';
import { confirmCommand } from './command-approval.helper.js';
import { outsideGrantedFolder, resolveCommandCwd } from './command-cwd.helper.js';
import { closeCapture, startCapture } from './capture.helper.js';
import type { Capture, CommandLaunchOptions, CommandToolName } from './run-command.types.js';
import { safeGitEnv, safeSteps } from './run-command.utils.js';

/**
 * Parses, resolves the folder of and gets approval for a command line, and returns the script to
 * run. Throws `ToolCallError` for a line the allow list cannot parse and `CommandRefusedError` when
 * the user does not approve. The call's `signal` is checked last so a task is never detached from
 * an interrupted call.
 */
export async function prepareCommand(params: {
  tool: CommandToolName;
  command: string;
  cwd: string | undefined;
  options: CommandLaunchOptions;
  signal: AbortSignal;
  context: ToolContext;
}): Promise<Omit<ScriptParams, 'signal'>> {
  const { tool, command, cwd, options, signal, context } = params;
  const { workspace, workingRoots, permissions, approvals } = options;
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
    tool,
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
  return { steps: safeSteps(parsed.steps), cwd: commandCwd, env: safeGitEnv() };
}

/**
 * What background commands start in and the session that owns them. Call it before
 * `prepareCommand`, so a run with no task starter, or a call outside a session, refuses before
 * the user is asked to approve a command that could not start. Throws `ToolCallError` for either.
 */
export function requireBackground(params: {
  tasks: TaskStarter | undefined;
  tool: CommandToolName;
  context: ToolContext;
}): { tasks: TaskStarter; sessionId: SessionId } {
  const { tasks, tool, context } = params;

  if (!tasks) {
    throw new ToolCallError({
      reason: 'unavailable',
      message: 'Background commands are not enabled in this harness',
    });
  }

  return { tasks, sessionId: requireTaskSession({ context, tool }) };
}

/**
 * Starts a prepared command as background work of the kind `toWork` builds, owned by `sessionId`
 * (the caller's: see `requireTaskSession`), with its output captured. Returns the started task and
 * the capture it runs with.
 */
export async function startCommandWork(params: {
  tasks: TaskStarter;
  sessionId: SessionId;
  toWork: (input: WorkInput) => WorkDefinition;
  command: string;
  script: Omit<ScriptParams, 'signal'>;
  outputs: OutputCapture | undefined;
  processes: ProcessRunner;
  signal: AbortSignal;
  context: ToolContext;
}): Promise<{ task: ReturnType<typeof startWork>; capture: Capture }> {
  const { tasks, sessionId, toWork, command, script, outputs, processes, signal, context } = params;

  const capture = await startCapture(outputs);
  const writer = capture && 'writer' in capture ? capture.writer : undefined;

  try {
    // An abort during the capture start must not detach a task from an interrupted call.
    signal.throwIfAborted();

    // Not tied to `signal`: the task outlives this call (and this turn) until it exits or is cancelled.
    const task = startWork({
      tasks,
      work: toWork({
        command,
        description: context.description,
        callId: context.callId,
        sessionId,
        ...(writer && { capture: writer }),
        run: ({ signal: taskSignal, onOutput }) =>
          processes.runScript({ ...script, signal: taskSignal, onOutput }),
      }),
    });

    return { task, capture };
  } catch (caughtError) {
    // No task owns the writer, so nothing else would close its file.
    if (writer) await closeCapture(writer);
    throw caughtError;
  }
}
