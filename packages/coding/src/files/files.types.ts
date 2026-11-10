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
