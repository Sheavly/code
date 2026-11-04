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
