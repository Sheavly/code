/**
 * Config for the git that inspects a folder the agent chose: the settings that could make git run
 * a program are set to run none, above the repo's own. `run_command` does the same for the
 * commands it runs (`SAFE_GIT_CONFIG` in `@sheavly/coding`). The user's own global git config
 * still applies (`HOME` is passed on), which is trusted; only the repo's config is not.
 */
export const CHECKOUT_GIT_FLAGS = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'safe.bareRepository=explicit',
];

/** No system-wide git config either. */
export const CHECKOUT_GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1' };
