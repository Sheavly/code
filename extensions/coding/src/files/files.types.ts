import type { KeyedLocks } from '@sheavly/runtime/locks/keyed-locks.service';
import type { FileReads } from '@sheavly/workspace/file-reads/file-reads.service';
import type { WorkingRoots } from '@sheavly/workspace/working-root/working-roots.service';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';

/** The services the tools that change a file take from the run they are built in. */
export type FileToolServices = {
  workspace: Workspace;
  /** Where relative paths start, when the agent chose a working root. Default: the workspace root. */
  workingRoots?: WorkingRoots | undefined;
  fileLocks: KeyedLocks;
  fileReads: FileReads;
};

/** The verb a file tool reports its change with, capitalised as the summary line starts. */
export type FileChangeVerb = 'Created' | 'Edited' | 'Deleted';

/**
 * The artifact the file tools return: a file they created, changed or deleted, enough for a UI to
 * render a diff. Rendering the diff is the UI's job.
 */
export type FileChange = {
  kind: 'file_change';
  /** Relative to the workspace root, e.g. `src/index.ts`. */
  path: string;
  /** The content before the change; `null` if the tool created the file. */
  before: string | null;
  /** The content after it; `null` if the tool deleted the file. */
  after: string | null;
};
