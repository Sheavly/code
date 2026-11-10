import type { GrepMode } from './grep.types.js';

/** The output modes `grep` offers: matching lines, only the files that match, or counts per file. */
export const GREP_MODES = ['content', 'files', 'count'] as const;

/** Most results (lines, files or counts) returned per call; the rest is reported as cut. */
export const MAX_GREP_RESULTS = 200;

/** Longest matching line shown; ripgrep shortens a longer one and says so. */
export const MAX_GREP_LINE_CHARS = 300;

/** Backstop: ripgrep is stopped once it has printed this much, however few results that is. */
export const MAX_GREP_RAW_CHARS = 2_000_000;

/** A search that runs longer than this is stopped and the agent is told to narrow it. */
export const GREP_TIMEOUT_MS = 30_000;

/** The flag that picks each mode's output shape. */
export const GREP_MODE_FLAGS: Record<GrepMode, string> = {
  content: '--line-number',
  files: '--files-with-matches',
  count: '--count',
};

/**
 * Passed last, so they win over the agent's own `glob`: secret files and git internals are never
 * searched, whatever pattern or glob the call carries.
 */
export const GREP_EXCLUDE_ARGS = [
  '--glob',
  '!**/.env',
  '--glob',
  '!**/.env.*',
  '--glob',
  '!**/.git',
  '--glob',
  '!**/.git/**',
];
