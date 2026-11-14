import type { ApprovalConcern, ApprovalOption } from '@sheavly/protocol/approval/approval.types';
import type { CallId } from '@sheavly/protocol/message/message.types';
import type { AllowEntry, PermissionMode } from '@sheavly/protocol/permission/permission.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import type { ScriptStep } from '@sheavly/workspace/process/process.types';
import { CommandRefusedError } from '../errors/run-command.errors.js';
import { BUILT_IN_ALLOW } from './allow-list.constants.js';
import { isAllowed } from './allow-list.utils.js';
import { suggestEntry } from './allow-entry.utils.js';
import { gitWorktreeSubcommand } from './command-base.utils.js';
import { NOT_ALLOWED, WORKTREE_CHANGING_SUBCOMMANDS } from './run-command.constants.js';
import type { CommandPermissions, CommandToolName } from './run-command.types.js';

type AskingMode = Exclude<PermissionMode, 'allow_all'>;

function hasCommandGrant(params: {
  argv: readonly string[];
  allow: readonly AllowEntry[];
}): boolean {
  const { argv, allow } = params;

  if (isAllowed({ argv, allowList: allow })) return true;

  return !/[\\/]/.test(argv[0] ?? '') && isAllowed({ argv, allowList: BUILT_IN_ALLOW });
}

/** Only unapproved commands need a decision, regardless of their options and paths. */
function findLineConcerns(params: { unlisted: readonly ScriptStep[]; mode: AskingMode }): {
  concerns: ApprovalConcern[];
  entries: AllowEntry[];
} {
  const { unlisted, mode } = params;
  const notAllowed = unlisted.map((step) => ({
    argument: step.argv.join(' '),
    reason: NOT_ALLOWED[mode],
  }));

  return {
    concerns: notAllowed,
    entries: [
      ...new Set(
        unlisted.flatMap(({ argv }) => {
          const entry = suggestEntry(argv);

          return entry ? [entry] : [];
        }),
      ),
    ],
  };
}

function offeredOptions(params: {
  entries: AllowEntry[] | undefined;
  session: boolean;
}): ApprovalOption[] {
  const { entries, session } = params;

  return entries?.length
    ? [
        'approve',
        ...(session ? ['allow_session' as const] : []),
        'always_allow',
        'skip',
        'skip_with_message',
      ]
    : ['approve', 'skip', 'skip_with_message'];
}

/** The commands to ask about: all of them when `askAll`, else those with no grant. */
function stepsNeedingAnswer(params: {
  steps: readonly ScriptStep[];
  allow: readonly AllowEntry[];
  askAll: boolean;
}): readonly ScriptStep[] {
  const { steps, allow, askAll } = params;

  return askAll ? steps : steps.filter(({ argv }) => !hasCommandGrant({ argv, allow }));
}

/** Whether `argv` is `git worktree add|move|repair`, which changes what the file tools can reach. */
function changesWorktrees(argv: readonly string[]): boolean {
  return WORKTREE_CHANGING_SUBCOMMANDS.includes(gitWorktreeSubcommand(argv) ?? '');
}

/**
 * The questions no grant answers: the folder, when the line runs where no grant reaches, and
 * every `git worktree add|move|repair`, because the folder it names becomes reachable by the file
 * tools for the rest of the session.
 */
function ungrantableConcerns(params: {
  steps: readonly ScriptStep[];
  outsideCwd: string | undefined;
}): ApprovalConcern[] {
  const { steps, outsideCwd } = params;
  const folder =
    outsideCwd === undefined
      ? []
      : [{ argument: `run in ${outsideCwd}`, reason: 'is outside the workspace root' }];
  const worktrees = steps
    .filter(({ argv }) => changesWorktrees(argv))
    .map(({ argv }) => ({
      argument: argv.join(' '),
      reason: 'makes that folder readable and writable by the file tools for this session',
    }));

  return [...folder, ...worktrees];
}

/**
 * Decides whether a parsed command line may run, and asks the user when it may not on its own.
 * Built-in and user grants cover every argument of the base command. `always_ask` ignores grants;
 * `allow_all` skips approval entirely, including the questions below. Each command in a chain is
 * checked, and one question covers every unapproved command. There are no path, secret, option or
 * package-verification re-prompts, except two that no grant answers: running in a folder no grant
 * reaches (`outsideCwd`), and `git worktree add|move|repair`. Both are asked every time,
 * with every command of the line, and their answer is never kept as a grant.
 *
 * Throws a `CommandRefusedError` when no one can answer, or the user skips (a message they sent
 * instead is put in the error, so the model reads it as the user's direction). On "always allow"
 * the entries are kept (`permissions.allow`) before the line runs; if that fails, the error is
 * thrown and the line does not run.
 */
export async function confirmCommand(params: {
  /** The tool asking, so the user and a UI see which one wants to run the line. */
  tool: CommandToolName;
  command: string;
  steps: readonly ScriptStep[];
  permissions: CommandPermissions;
  approvals: ApprovalRegistry | undefined;
  call: { callId: CallId; sessionId?: SessionId | undefined };
  signal: AbortSignal;
  /**
   * The folder the line runs in when no grant reaches it: outside the workspace root and not in a
   * verified sibling worktree (those share the root's mode and allow list), so the scratch folder.
   * Every command is asked about, the folder is shown, and the answer is never kept as a grant.
   * `allow_all` still asks nothing.
   */
  outsideCwd?: string | undefined;
}): Promise<void> {
  const { tool, command, steps, permissions, approvals, call, signal, outsideCwd } = params;
  const { mode, allow } = await permissions.read();

  if (mode === 'allow_all') return;

  const unlisted = stepsNeedingAnswer({
    steps,
    allow,
    askAll: mode === 'always_ask' || outsideCwd !== undefined,
  });
  const { concerns: lineConcerns, entries: proposed } = findLineConcerns({ unlisted, mode });
  const alwaysAsked = ungrantableConcerns({ steps, outsideCwd });
  const concerns = [...alwaysAsked, ...lineConcerns];

  if (concerns.length === 0) return;

  const listed = concerns.map(({ argument, reason }) => `- ${argument}: ${reason}`).join('\n');

  if (!approvals?.listening) {
    throw new CommandRefusedError({
      reason: 'needs_approval',
      command,
      message: `Command refused, it needs the user's approval: ${command}\n${listed}`,
    });
  }

  const entries = mode === 'ask' && alwaysAsked.length === 0 ? proposed : undefined;
  const response = await approvals.request({
    ...call,
    tool,
    command,
    concerns,
    options: offeredOptions({ entries, session: permissions.allowSession !== undefined }),
    ...(entries && { keeps: entries }),
    signal,
  });

  if (response.decision === 'approve') return;

  if (response.decision === 'allow_session' && permissions.allowSession) {
    for (const entry of entries ?? []) await permissions.allowSession(entry);

    return;
  }

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
