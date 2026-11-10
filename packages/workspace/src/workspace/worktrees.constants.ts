/** `git worktree list` reads local files only; this stops a hung git from stalling a tool call. */
export const GIT_TIMEOUT_MS = 5000;

/** The exit code git uses for "not a git repository" (and other fatal errors). */
export const GIT_FATAL_EXIT_CODE = 128;

/**
 * The only variables git is given: it needs a way to find itself and the user's config, and
 * nothing else (no `GIT_DIR` or `GIT_CONFIG_*` redirecting which repo is listed, no API keys).
 */
export const GIT_ENV_KEYS = ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'LANG'] as const;

/**
 * Filesystem errors that mean "this entry can't be used as a worktree" (gone, unreadable, a
 * loop, a name that can't exist): the entry is left out, so one forged entry can't hide the rest. Anything else (`EIO`, ...) is a failure to check, never "fine".
 */
export const UNUSABLE_ENTRY_CODES: readonly string[] = [
  'ENOENT',
  'ENOTDIR',
  'EACCES',
  'EPERM',
  'ELOOP',
  'EISDIR',
  'ENAMETOOLONG',
  'EINVAL',
];
