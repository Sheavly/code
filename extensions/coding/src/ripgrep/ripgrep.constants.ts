/** Backstop: ripgrep is stopped once it has printed this much, however few results that is. */
export const MAX_GREP_RAW_CHARS = 2_000_000;

/** A search that runs longer than this is stopped and the agent is told to narrow it. */
export const GREP_TIMEOUT_MS = 30_000;

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
