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
