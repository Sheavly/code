import type { Workspace } from '../workspace/workspace.service.js';

/** A temp workspace from `useTempWorkspace`; readable only while its tests run. */
export type TempWorkspace = {
  /** The temp dir; holds the workspace and the files outside it. */
  readonly base: string;
  /** The workspace root, `base/workspace`. */
  readonly root: string;
  readonly workspace: Workspace;
};

/** A temp git repo from `useTempRepo`; readable only while its tests run. */
export type TempRepo = {
  /** The temp dir; holds the repo, its worktree and the files outside both. */
  readonly base: string;
  /** The repo's main worktree, with `src/index.ts` committed. */
  readonly main: string;
  /** A folder in no worktree, for escape tests. */
  readonly outside: string;
  /** A second worktree of the repo, on branch `feature`, next to `main`. */
  readonly worktree: string;
};
