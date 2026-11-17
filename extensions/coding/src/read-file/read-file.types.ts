/** The lines `selectLines` returned: 1-based, inclusive. `whole` when that is every line, uncut. */
export type ShownLines = {
  start: number;
  end: number;
  total: number;
  whole: boolean;
};

/** What one pass over a file gives `read_file`: the lines to show, the file's size in lines, its hash. */
export type StreamedLines = {
  /** The lines from the first one asked for, at most `maxLines` of them, each cut to `maxChars + 1`. */
  window: string[];
  /** Every line of the file, counted as `selectLines` counts them. */
  total: number;
  endsWithNewline: boolean;
  /** `hashText` of the whole file's text. */
  hash: string;
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
