import type { Workspace } from '../workspace/workspace.service.js';

/** A temp workspace from `useTempWorkspace`; readable only while its tests run. */
export type TempWorkspace = {
  /** The temp dir; holds the workspace and the files outside it. */
  readonly base: string;
  /** The workspace root, `base/workspace`. */
  readonly root: string;
  readonly workspace: Workspace;
};
