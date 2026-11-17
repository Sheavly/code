// postToolUse and postToolUseFailure (Shell): which project files the command just changed,
// compared with the snapshot guard-shell-commands.mjs took before it ran (a failing command can
// still write, so both events run this). Changed files skipped the edit tools' hooks: the chat is
// recorded as having edited the checkout, so the stop hook's gate checks them. A command that
// changed files and isn't a known writer (shell-writes.utils.mjs) is a workaround the shell guard
// missed: the agent is told to teach the guard, and the stop hook holds it to that. Several chats
// can share the checkout, so a file another chat edited while the command ran is left out
// (chat-files.utils.mjs).
import {
  editedFilesFields,
  filesEditedWithToolsSince,
  filesOtherChatsEdited,
} from './chat-files.utils.mjs';
import { linkFromToolCall } from './chat-links.utils.mjs';
import { changeChatState, getChatState } from './chat-state.utils.mjs';
import { hookNow, PROJECT_ROOT, readHookInput, respond } from './hooks.utils.mjs';
import { snapshotBefore, withoutSnapshot } from './shell-snapshots.utils.mjs';
import { changedFiles, isSanctionedWriter, snapshotProject } from './shell-writes.utils.mjs';
import { verifiedFormatterWrite, withoutFormatterWrites } from './formatter-attribution.utils.mjs';

/** The Shell tool's input: an object, or the same as a JSON string. */
function readToolInput(toolInput) {
  return typeof toolInput === 'string' ? JSON.parse(toolInput) : (toolInput ?? {});
}

function workaroundNote(params) {
  const { command, files } = params;

  return [
    `This shell command changed project files without the edit tools: ${files.join(', ')}.`,
    '```',
    command,
    '```',
    'Edits made past the edit tools are never formatted or linted after the edit and show no diff ' +
      'in the editor. Before you finish:',
    '1. Add the command to DENIED_CASES in .cursor/hooks/shell-guard-cases.utils.mjs.',
    '2. Teach the guard (.cursor/hooks/shell-guard.utils.mjs) the technique, not the one string, ' +
      'until the guard test passes with every ALLOWED_CASES entry still allowed.',
    '3. Redo the change with StrReplace/Write: re-read the files first, since they changed.',
    'The stop hook checks that the guard now denies this command. If it is a legitimate writer ' +
      '(a project script or tool), tell the user instead: only they add to SANCTIONED_WRITERS ' +
      'in .cursor/hooks/shell-writes.utils.mjs.',
  ].join('\n');
}

const input = await readHookInput();
const conversationId = input.conversation_id;
const toolInput = readToolInput(input.tool_input);
const command = typeof toolInput.command === 'string' ? toolInput.command : '';

// A subagent's shell writes are checked by the chat that started it (chat-links.utils.mjs).
linkFromToolCall(input);
const state = conversationId ? getChatState(conversationId) : null;
const recorded = state?.shellSnapshots?.[command];
const before = snapshotBefore({ snapshots: state?.shellSnapshots, command });
const after = before ? snapshotProject(PROJECT_ROOT) : null;
// Read after the snapshot: an edit hook running together with the command records its edit in
// this state, and writing back an older copy would lose it.
const latest = conversationId ? getChatState(conversationId) : null;
// A file another chat edited while the command ran is that chat's change, not the command's, and
// neither is one this chat edited with the edit tools: tool calls sent together run together. A
// snapshot from before snapshots were timed can't be told apart: all of its changes count.
const othersEdited = before?.takenAt
  ? filesOtherChatsEdited({ exclude: [conversationId], since: before.takenAt })
  : new Set();
const toolEdited = filesEditedWithToolsSince({ state: latest, since: before?.takenAt });
const changed = after
  ? changedFiles({ before, after }).filter(
      (file) => !othersEdited.has(file) && !toolEdited.has(file),
    )
  : [];
const endedAt = hookNow();
const writeHashes = Object.fromEntries(
  changed.map((file) => [
    file,
    {
      before: before.files[file] ?? null,
      after: after.files[file] ?? null,
    },
  ]),
);
const observed = { command, files: changed, at: before?.takenAt, endedAt, writeHashes };
const writes = latest?.verifiedFormatterWrites ?? [];
const [remaining] = withoutFormatterWrites({ commands: [observed], writes });
const files = remaining?.files ?? [];

// Without a snapshot to compare with (one too old to trust, from a command that ran for hours or
// one a crash left behind, or none at all) the command's writes can't be told. The chat is
// recorded as having edited without a complete list, in the same write that drops the snapshot, so
// its stop gate runs unscoped rather than skipping whatever the command wrote.
const unverifiable = !before;

if (conversationId && (recorded || unverifiable)) {
  changeChatState({
    conversationId,
    change: ({ shellSnapshots }) => ({
      shellSnapshots: withoutSnapshot({ snapshots: shellSnapshots, command }),
      ...(unverifiable && { editedProjectSource: true, editedFilesComplete: false }),
    }),
  });
}

if (files.length === 0 || isSanctionedWriter(command)) {
  if (files.length > 0) {
    changeChatState({
      conversationId,
      change: (current) => editedFilesFields({ state: current, files }),
    });
  }

  const verified =
    before && after
      ? verifiedFormatterWrite({
          command,
          before,
          after,
          projectRoot: PROJECT_ROOT,
          endedAt,
        })
      : undefined;

  if (verified && isSanctionedWriter(command)) {
    // Verification reads files, so the lists are extended from the state under the lock: a
    // concurrent after-hook's newly recorded finding or formatter evidence is kept.
    changeChatState({
      conversationId,
      change: (current) => {
        const verifiedFormatterWrites = [...(current.verifiedFormatterWrites ?? []), verified];

        return {
          verifiedFormatterWrites,
          unguardedCommands: withoutFormatterWrites({
            commands: current.unguardedCommands ?? [],
            writes: verifiedFormatterWrites,
          }),
        };
      },
    });
  }

  respond({});
} else {
  const cwd = input.cwd || toolInput.cwd || PROJECT_ROOT;
  const entry = {
    command,
    cwd,
    projectRoot: PROJECT_ROOT,
    files,
    at: before.takenAt,
    endedAt,
    writeHashes,
  };

  changeChatState({
    conversationId,
    change: (current) => ({
      ...editedFilesFields({ state: current, files }),
      unguardedCommands: [
        ...(current.unguardedCommands ?? []).filter((known) => known.command !== command),
        entry,
      ],
    }),
  });
  respond({ additional_context: workaroundNote({ command, files }) });
}
