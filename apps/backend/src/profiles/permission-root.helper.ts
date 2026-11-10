import type { Environment } from '@sheavly/core/environment/environment.types';
import { findMainRoot } from '@sheavly/workspace/workspace/worktrees.helper';

/**
 * The folder a workspace's permissions are kept under: its place in the repo's main worktree, so
 * every worktree of a repo shares one mode and allow list. `workspace` is a real path; it is
 * returned as it is when it is not in a git repo or its worktree link does not verify, so a
 * forged `.git` file can never borrow another folder's permissions. Throws a `PathCheckError`
 * when git cannot be checked (a timeout, an unreadable folder): the folder's own file may hold
 * looser permissions than the shared one, so the caller decides what to do instead of guessing.
 */
export function permissionRoot(params: { workspace: string; env: Environment }): Promise<string> {
  return findMainRoot({ root: params.workspace, env: params.env });
}
