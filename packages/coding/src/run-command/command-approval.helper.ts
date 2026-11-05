import type { ApprovalConcern, ApprovalOption } from '@sheavly/protocol/approval/approval.types';
import type { CallId } from '@sheavly/protocol/message/message.types';
import type { AllowEntry, PermissionMode } from '@sheavly/protocol/permission/permission.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import type { ScriptStep } from '@sheavly/workspace/process/process.types';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { CommandRefusedError } from '../errors/run-command.errors.js';
import { suggestEntry } from './allow-entry.utils.js';
import { BUILT_IN_ALLOW } from './allow-list.constants.js';
import { isAllowed } from './allow-list.utils.js';
import { findConcerns } from './arguments.helper.js';
import type { CommandPermissions } from './run-command.types.js';

type AskingMode = Exclude<PermissionMode, 'allow_all'>;

const NOT_ALLOWED: Record<AskingMode, string> = {
  ask: 'is not allowed yet',
  always_ask: 'is asked about every time in this folder',
};

/** What in the line needs the user's say: commands not allowed, and the risky arguments of any. */
async function findLineConcerns(params: {
  workspace: Workspace;
  steps: readonly ScriptStep[];
  unlisted: readonly ScriptStep[];
  mode: AskingMode;
}): Promise<ApprovalConcern[]> {
  const { workspace, steps, unlisted, mode } = params;
  const notAllowed = unlisted.map((step) => ({
    argument: step.argv.join(' '),
    reason: NOT_ALLOWED[mode],
  }));
  const risky = await Promise.all(
    steps.map(({ argv: [file, ...args] }) => findConcerns({ workspace, file, args })),
  );

  return [...notAllowed, ...risky.flat()];
}

/**
 * The entries "always allow" would keep for the commands not allowed yet, or undefined when it
 * can't be offered: nothing to allow (only risky arguments, which are asked every time), a
 * command no entry can spell, or a folder that asks about everything whatever the list says.
 */
function entriesToKeep(params: {
  unlisted: readonly ScriptStep[];
  mode: AskingMode;
}): AllowEntry[] | undefined {
  const { unlisted, mode } = params;
  const entries = unlisted.map((step) => suggestEntry(step.argv));

  if (mode !== 'ask' || unlisted.length === 0) return undefined;
  if (entries.some((entry) => entry === undefined)) return undefined;

  return [...new Set(entries as AllowEntry[])];
}

function offeredOptions(entries: AllowEntry[] | undefined): ApprovalOption[] {
  return entries
    ? ['approve', 'always_allow', 'skip', 'skip_with_message']
    : ['approve', 'skip', 'skip_with_message'];
}

/**
 * Decides whether a parsed command line may run, and asks the user when it may not on its own.
 * In `allow_all` it always runs. Otherwise a command needs the user's say when it is not built in
 * or allowed by the user (in `always_ask`, every command), and any command with a risky argument
 * (outside the workspace, `.env`, a glob, git output that shows file contents) needs it in every
 * mode but `allow_all`. One question covers the whole line, and skipping it skips every command in
 * it.
 *
 * Throws a `CommandRefusedError` when no one can answer, or the user skips (a message they sent
 * instead is put in the error, so the model reads it as the user's direction). On "always allow"
 * the entries are kept (`permissions.allow`) before the line runs; if that fails, the error is
 * thrown and the line does not run.
 */
export async function confirmCommand(params: {
  workspace: Workspace;
  command: string;
  steps: readonly ScriptStep[];
  permissions: CommandPermissions;
  approvals: ApprovalRegistry | undefined;
  call: { callId: CallId; sessionId?: SessionId | undefined };
  signal: AbortSignal;
}): Promise<void> {
  const { workspace, command, steps, permissions, approvals, call, signal } = params;
  const { mode, allow } = await permissions.read();

  if (mode === 'allow_all') return;

  const allowed = [...BUILT_IN_ALLOW, ...allow];
  const unlisted =
    mode === 'always_ask'
      ? steps
      : steps.filter(({ argv }) => !isAllowed({ argv, allowList: allowed }));
  const concerns = await findLineConcerns({ workspace, steps, unlisted, mode });

  if (concerns.length === 0) return;

  const listed = concerns.map(({ argument, reason }) => `- ${argument}: ${reason}`).join('\n');

  if (!approvals?.listening) {
    throw new CommandRefusedError({
      reason: 'needs_approval',
      command,
      message: `Command refused, it needs the user's approval: ${command}\n${listed}`,
    });
  }

  const entries = entriesToKeep({ unlisted, mode });
  const response = await approvals.request({
    ...call,
    tool: 'run_command',
    command,
    concerns,
    options: offeredOptions(entries),
    signal,
  });

  if (response.decision === 'approve') return;

  if (response.decision === 'always_allow') {
    for (const entry of entries ?? []) await permissions.allow(entry);

    return;
  }

  const steer =
    response.decision === 'skip_with_message'
      ? `\n\nInstead, the user says: ${response.message}`
      : '\n\nDo not retry it without asking the user.';

  throw new CommandRefusedError({
    reason: 'skipped',
    command,
    message: `The user skipped this command: ${command}\n${listed}${steer}`,
  });
}
