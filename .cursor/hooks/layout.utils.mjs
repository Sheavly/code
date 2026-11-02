// The workspace layout for the post-edit hook: TypeScript written outside every workspace's src/
// is reported on the edit, not first at the stop check (scripts/check-layout.mjs fails it there).
// The rules live in the shared layout (packages/eslint-config/src/layout.js), so the hook, the
// check and lint can't disagree.
import {
  isStraySource,
  listWorkspaces,
  STRAY_SOURCE,
} from '../../packages/eslint-config/src/layout.utils.js';
import { findRoot } from '../../packages/eslint-config/src/rules/workspace-types.js';
import { PROJECT_ROOT } from './hooks.utils.mjs';

/** A note for an edit of `relative` (`/`-separated, from the root) when it is stray source. */
export function strayEditNote(relative, root = PROJECT_ROOT) {
  // Outside a workspace repo (a throwaway test project) there is no layout to hold it to.
  if (findRoot(root) !== root) return null;

  return isStraySource({ workspaces: listWorkspaces(root), file: relative })
    ? `Layout: ${relative} is outside every workspace: ${STRAY_SOURCE}`
    : null;
}
