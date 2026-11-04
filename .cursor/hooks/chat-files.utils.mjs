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
