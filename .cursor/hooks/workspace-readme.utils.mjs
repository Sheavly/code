// The workspace router on touch: the first edit inside a workspace in a chat shows that
// workspace's README, the first place to look (what it is for, its public API, an example, its
// docs). Read from the workspaces, so a new one is covered by existing; once per workspace per
// chat, so the context arrives when work there starts and never again.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { workspaceOfRelative } from '../../packages/eslint-config/src/layout.utils.js';
import { keepShownInChat, shownInChat } from './chat-state.utils.mjs';
import { PROJECT_ROOT } from './hooks.utils.mjs';
import { readWorkspaces } from './layout.utils.mjs';

/** The workspace (`{ name, relative }`) that holds `relative`, a `/`-separated path; or undefined. */
export function workspaceOf(params) {
  const { root, relative } = params;

  return workspaceOfRelative({ workspaces: readWorkspaces(root), file: relative });
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

  const field = 'workspaceReadmesShown';

  if (shownInChat({ conversationId, field }).has(workspace.name)) return [];

  const note = readmeNote({ root, workspace });

  if (!note) return [];

  keepShownInChat({ conversationId, field, values: [workspace.name] });

  return [note];
}
