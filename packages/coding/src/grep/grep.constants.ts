import type { GrepMode } from './grep.types.js';

/** The output modes `grep` offers: matching lines, only the files that match, or counts per file. */
export const GREP_MODES = ['content', 'files', 'count'] as const;

/** Most results (lines, files or counts) returned per call; the rest is reported as cut. */
export const MAX_GREP_RESULTS = 200;

/** Longest matching line shown; ripgrep shortens a longer one and says so. */
export const MAX_GREP_LINE_CHARS = 300;

/** The flag that picks each mode's output shape. */
export const GREP_MODE_FLAGS: Record<GrepMode, string> = {
  content: '--line-number',
  files: '--files-with-matches',
  count: '--count',
};
