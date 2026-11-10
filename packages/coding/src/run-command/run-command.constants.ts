/** Foreground commands are killed after this long unless the harness sets its own timeout. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

/**
 * Git config every command gets, above the repo's own: each setting that could make git run a
 * program set to run none. Given through the env (`GIT_CONFIG_COUNT`), so it also reaches git
 * that a test runner starts.
 */
export const SAFE_GIT_CONFIG = {
  'core.fsmonitor': '',
  'core.hooksPath': '/dev/null',
  'safe.bareRepository': 'explicit',
  'log.showSignature': 'false',
  'gpg.program': 'false',
  'gpg.ssh.program': 'false',
  'gpg.x509.program': 'false',
  // Attributes from the last commit (an empty tree before the first), not the working tree, so
  // an edited .gitattributes can't switch on a filter driver the config defines.
  'attr.tree': 'HEAD',
};

/** Why a command needs a decision, by the permission mode that asks. */
export const NOT_ALLOWED = {
  ask: 'is not allowed yet',
  always_ask: 'is asked about every time in this folder',
};

/** `git worktree` subcommands that put a folder on the repo's worktree list (and so in reach). */
export const WORKTREE_CHANGING_SUBCOMMANDS = ['add', 'move', 'repair'];

/** Git subcommands that can run a diff program, and the flags that stop them. */
export const DIFF_SUBCOMMANDS = ['diff', 'log', 'show'];
export const NO_DIFF_PROGRAM_FLAGS = ['--no-ext-diff', '--no-textconv'];
