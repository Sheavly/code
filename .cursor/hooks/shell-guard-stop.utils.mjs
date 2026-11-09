// The stop hook's check that the shell guard learned every workaround this chat used (recorded by
// record-shell-writes.mjs): the guard must deny each such command and DENIED_CASES must list it.
// And no case at HEAD may leave DENIED_CASES, so a guard is never weakened to pass.
import { spawnSync } from 'node:child_process';
import { filesOtherChatsEdited } from './chat-files.utils.mjs';
import { DENIED_CASES } from './shell-guard-cases.utils.mjs';
import { findShellViolation } from './shell-guard.utils.mjs';
import { isSanctionedWriter } from './shell-writes.utils.mjs';
import { commandsInCheckout } from './shell-checkout.utils.mjs';

const CASES_FILE = '.cursor/hooks/shell-guard-cases.utils.mjs';

/** DENIED_CASES as committed at HEAD, or null when HEAD has no cases file yet. */
async function committedDeniedCases(projectRoot) {
  const shown = spawnSync('git', ['show', `HEAD:${CASES_FILE}`], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  if (shown.status !== 0) return null; // not committed yet: nothing to shrink from
  const source = `data:text/javascript,${encodeURIComponent(shown.stdout)}`;

  return (await import(source)).DENIED_CASES;
}

function describeUnlearned(params) {
  const { unguardedCommands, projectRoot, othersEditedSince } = params;

  return unguardedCommands.flatMap(({ command, cwd, files, at, chat }) => {
    // Another chat may record its edit only after this command's after-hook ran: a file it edited
    // since the command started is its change. An entry without a start time can't be rechecked.
    const othersEdited = at ? othersEditedSince({ since: at, chat }) : new Set();
    const ownFiles = files.filter((file) => !othersEdited.has(file));

    if (ownFiles.length === 0) return [];
    // Recorded before the recorder knew it for a known writer (a parsing fix since): the same
    // check as the recorder's, by today's rules, so a fixed misreading stops counting.
    if (isSanctionedWriter(command)) return [];
    const denied = Boolean(findShellViolation({ command, cwd, projectRoot }));
    const listed = DENIED_CASES.includes(command);

    if (denied && listed) return [];
    const missing = [!denied && 'the guard still allows it', !listed && 'DENIED_CASES lacks it'];

    return [
      `- \`${command}\` (changed ${ownFiles.join(', ')}): ${missing.filter(Boolean).join('; ')}`,
    ];
  });
}

/**
 * A gate report section when the shell guard hasn't learned the workarounds of this chat (and its
 * subagents: pass them all as `unguardedCommands`, each with the `chat` that ran it), or null.
 * `othersEditedSince({ since, chat })` is the files chats other than `chat` recorded editing
 * since then (tests pass one).
 */
export async function shellGuardFailure(params) {
  const {
    state,
    projectRoot,
    conversationId,
    unguardedCommands = state?.unguardedCommands ?? [],
    othersEditedSince = ({ since, chat }) => {
      return filesOtherChatsEdited({ exclude: [chat ?? conversationId], since });
    },
  } = params;
  const lines = describeUnlearned({
    unguardedCommands: commandsInCheckout({ commands: unguardedCommands, projectRoot }),
    projectRoot,
    othersEditedSince,
  });
  const removed = ((await committedDeniedCases(projectRoot)) ?? []).filter(
    (command) => !DENIED_CASES.includes(command),
  );

  lines.push(...removed.map((command) => `- \`${command}\` was removed from DENIED_CASES`));
  if (lines.length === 0) return null;

  return (
    '## Shell guard (these commands changed files past the edit tools: add each to DENIED_CASES ' +
    `in ${CASES_FILE} and make .cursor/hooks/shell-guard.utils.mjs deny the technique; never ` +
    `remove a case)\n${lines.join('\n')}`
  );
}
