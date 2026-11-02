/** The lines `selectLines` returned: 1-based, inclusive. `whole` when that is every line, uncut. */
export type ShownLines = {
  start: number;
  end: number;
  total: number;
  whole: boolean;
};

/**
 * The artifact `read_file` returns: what a read covered, so a UI can say "read src/a.ts" or
 * "read src/a.ts lines 10–40" without parsing the text. `whole` when every line was returned.
 */
export type FileRead = {
  kind: 'file_read';
  /** Relative to the workspace root. */
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  whole: boolean;
};
