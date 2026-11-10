import type { GREP_MODES } from './grep.constants.js';

/** What a `grep` call returns: matching lines, the files that match, or a count per file. */
export type GrepMode = (typeof GREP_MODES)[number];

/** One matching line. */
export type GrepMatch = {
  /** Relative to the workspace root. */
  path: string;
  /** 1-based. */
  line: number;
  text: string;
};

/** How many lines of one file match. */
export type GrepCount = {
  /** Relative to the workspace root. */
  path: string;
  count: number;
};

/**
 * The artifact `grep` returns, so a UI can list matches without parsing the text: the results
 * for the mode asked, and `truncated` when there were more than were kept.
 */
export type GrepResult = {
  kind: 'grep_matches';
  pattern: string;
  /** The folder or file searched, relative to the workspace root (`.` for all of it). */
  searched: string;
  truncated: boolean;
  /** What ripgrep said it could not read (a permission error); empty when it read everything. */
  skipped: string;
} & (
  | { mode: 'content'; matches: GrepMatch[] }
  | { mode: 'files'; files: string[] }
  | { mode: 'count'; counts: GrepCount[] }
);
