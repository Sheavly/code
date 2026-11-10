/**
 * The artifact `glob` returns, so a UI can list files without parsing the text: the files
 * matching the pattern, newest first, and `truncated` when there were more than were kept.
 */
export type GlobResult = {
  kind: 'glob_files';
  pattern: string;
  /** The folder searched, relative to the workspace root (`.` for all of it). */
  searched: string;
  /** Relative to the workspace root, most recently modified first. */
  files: string[];
  truncated: boolean;
  /** What ripgrep said it could not read (a permission error); empty when it read everything. */
  skipped: string;
};
