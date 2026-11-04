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
import {
  getChatState,
  hookNow,
  PROJECT_ROOT,
  readHookInput,
  respond,
  updateChatState,
} from './hooks.utils.mjs';
import { changedFiles, isSanctionedWriter, snapshotProject } from './shell-writes.utils.mjs';

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
const { [command]: before, ...otherSnapshots } = state?.shellSnapshots ?? {};
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
const files = after
  ? changedFiles({ before, after }).filter(
      (file) => !othersEdited.has(file) && !toolEdited.has(file),
    )
  : [];

if (conversationId && before) updateChatState({ conversationId, shellSnapshots: otherSnapshots });

if (files.length === 0 || isSanctionedWriter(command)) {
  if (files.length > 0) {
    updateChatState({ conversationId, ...editedFilesFields({ state: latest, files }) });
  }

  respond({});
} else {
  const unguarded = (latest?.unguardedCommands ?? []).filter((entry) => entry.command !== command);
  const cwd = input.cwd || toolInput.cwd || PROJECT_ROOT;

  updateChatState({
    conversationId,
    ...editedFilesFields({ state: latest, files }),
    unguardedCommands: [
      ...unguarded,
      { command, cwd, files, at: before.takenAt, endedAt: hookNow() },
    ],
  });
  respond({ additional_context: workaroundNote({ command, files }) });
}
