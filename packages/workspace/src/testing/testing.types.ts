import type { TrustPersistence } from '../trust/trust.types.js';
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

/** The skill folders from `useSkillFolders`; readable only while its tests run. */
export type SkillFolders = {
  /** The temp dir; holds `project/` and `home/`. */
  readonly base: string;
  /** The project root, with `.sheavly/skills/` and `.agents/skills/`. */
  readonly root: string;
  /** The user's home, with `.sheavly/skills/` and `.agents/skills/`. */
  readonly home: string;
};

/** A `TrustPersistence` in memory (`memoryTrust`), and the ways a test can make it misbehave. */
export type MemoryTrust = TrustPersistence & {
  /** Sets the stored document as a file would hold it (any JSON, or `undefined` for none). */
  set(document: unknown): void;
  /** The stored document now. */
  get(): unknown;
  /** Makes `load` and `update` reject with `error`; `undefined` mends it. */
  failWith(error: Error | undefined): void;
};
