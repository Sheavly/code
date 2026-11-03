// The workspace router on touch: the first edit inside a workspace in a chat shows that
// workspace's README, the first place to look (what it is for, its public API, an example, its
// docs). Read from the workspaces, so a new one is covered by existing; once per workspace per
// chat, so the context arrives when work there starts and never again.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getChatState, PROJECT_ROOT, updateChatState } from './hooks.utils.mjs';
import { readWorkspaces } from './layout.utils.mjs';

/** The workspace (`{ name, relative }`) that holds `relative`, a `/`-separated path; or undefined. */
export function workspaceOf(params) {
  const { root, relative } = params;

  return readWorkspaces(root)
    .filter((workspace) => workspace.relative !== '.')
    .filter((workspace) => relative.startsWith(`${workspace.relative}/`))
    .sort((a, b) => b.relative.length - a.relative.length)[0];
}

/** The note that shows `workspace`'s README, or null when it has none (the layout check says so). */
export function readmeNote(params) {
  const { root, workspace } = params;
  const readme = `${workspace.relative}/README.md`;
  const file = path.join(root, readme);

  if (!existsSync(file)) return null;

  return `You're working in ${workspace.name} (${workspace.relative}). Its README, the first place to look; its docs/ goes deeper, and the sheavly-packages skill routes to the other workspaces:\n\n${readFileSync(file, 'utf8').trim()}`;
}

/** The README note for the first edit inside a workspace in this chat; [] otherwise. */
export function hintWorkspaceReadme(params) {
  const { conversationId, relative, root = PROJECT_ROOT } = params;
  const workspace = workspaceOf({ root, relative });

  if (!workspace) return [];

  const shown = new Set(getChatState(conversationId)?.workspaceReadmesShown ?? []);

  if (shown.has(workspace.name)) return [];

  const note = readmeNote({ root, workspace });

  if (!note) return [];

  updateChatState({ conversationId, workspaceReadmesShown: [...shown, workspace.name] });

  return [note];
}
