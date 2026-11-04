// Which project files each chat edited, and when, so a hook answers only for its own chat's work.
// Several chats can work in one checkout at once: what changed on disk isn't all this chat's. The
// edit hook (lint-edited-file.mjs) and the shell recorder (record-shell-writes.mjs) record each
// file with the time; the shell recorder leaves out what another chat edited while its command
// ran, and the stop hook reports only problems in what this chat and its subagents edited
// (gate-scope.utils.mjs, chat-links.utils.mjs).
import { chatStateId, hookNow, listChatStates } from './hooks.utils.mjs';

/**
 * The state fields that record `files` (project-relative) as edited by this chat at `now`. A chat
 * that edited before files were recorded keeps an incomplete list: its gate stays unscoped.
 */
export function editedFilesFields(params) {
  const { state, files, now = hookNow() } = params;
  const edited = Object.fromEntries(files.map((file) => [file, now]));
  const complete = state?.editedFiles
    ? state.editedFilesComplete !== false
    : state?.editedProjectSource !== true;

  return {
    editedProjectSource: true,
    editedFiles: { ...state?.editedFiles, ...edited },
    editedFilesComplete: complete,
  };
}

/** The files this chat edited; null when they aren't all recorded (a chat from before). */
export function chatEditedFiles(state) {
  if (!state?.editedFiles || state.editedFilesComplete === false) return null;

  return Object.keys(state.editedFiles).sort();
}

/**
 * How long after a shell command ended an edit made with the edit tools still counts as made while
 * it ran: tool calls sent together run together, and their hooks can finish after the command's.
 * A redo after the recorder's note takes a model round trip, which is longer.
 */
export const SHELL_OVERLAP_MS = 5000;

/**
 * The state fields that record `files` as edited with the edit tools at `now`: `editedFilesFields`,
 * plus when each was edited that way (`toolEditedFiles`), so the shell recorder can tell it from a
 * shell command's change. The files also come off a recorded shell command that ran together with
 * the edit (it started before `now`, and ended no more than `SHELL_OVERLAP_MS` before): the edit
 * tools made that change, not the command. A later edit of the same file does not excuse a command.
 */
export function editToolFields(params) {
  const { state, files, now = hookNow() } = params;
  const edited = Object.fromEntries(files.map((file) => [file, now]));
  const commands = state?.unguardedCommands;

  return {
    ...editedFilesFields({ state, files, now }),
    toolEditedFiles: { ...state?.toolEditedFiles, ...edited },
    ...(commands && { unguardedCommands: withoutOverlappingEdits({ commands, files, now }) }),
  };
}

function withoutOverlappingEdits(params) {
  const { commands, files, now } = params;

  return commands.flatMap((entry) => {
    // An entry recorded before commands were timed can't be told apart: it stays.
    const overlaps =
      entry.endedAt !== undefined && entry.at <= now && now <= entry.endedAt + SHELL_OVERLAP_MS;

    if (!overlaps) return [entry];
    const remaining = entry.files.filter((file) => !files.includes(file));

    return remaining.length > 0 ? [{ ...entry, files: remaining }] : [];
  });
}

/**
 * The files this chat edited with the edit tools at or after `since` (ms since the epoch); none
 * when `since` is unknown.
 */
export function filesEditedWithToolsSince(params) {
  const { state, since } = params;

  if (since === undefined) return new Set();

  return new Set(
    Object.entries(state?.toolEditedFiles ?? {})
      .filter(([, at]) => at >= since)
      .map(([file]) => file),
  );
}

/**
 * The files any chat other than the `exclude`d ones (conversation ids) recorded editing at or
 * after `since` (ms since the epoch).
 */
export function filesOtherChatsEdited(params) {
  const { exclude, since } = params;
  const excluded = new Set([...exclude].map(chatStateId));
  const files = new Set();

  for (const { id, state } of listChatStates()) {
    if (excluded.has(id)) continue;

    for (const [file, at] of Object.entries(state?.editedFiles ?? {})) {
      if (at >= since) files.add(file);
    }
  }

  return files;
}
