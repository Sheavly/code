/**
 * One change a tool made to a file, kept for the chat to show again: numbered in the order the
 * changes were made, with how many lines it added and removed. `before` is `null` when it
 * created the file, and `after` is `null` when it deleted it.
 */
export type FileEdit = {
  number: number;
  /** Relative to the workspace root. */
  path: string;
  before: string | null;
  after: string | null;
  added: number;
  removed: number;
};

/**
 * Turns a path relative to the workspace root into the text that shows it: the path itself, as a
 * link to the file when the terminal can open one. The text has the path's width on screen.
 */
export type LinkFile = (path: string) => string;

/** All the edits of one file in the chat: what it was before the first, and is after the last. */
export type FileTotal = {
  path: string;
  edits: FileEdit[];
  before: string | null;
  after: string | null;
};
