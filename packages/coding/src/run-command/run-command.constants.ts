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

/** Git subcommands that can run a diff program, and the flags that stop them. */
export const DIFF_SUBCOMMANDS = ['diff', 'log', 'show'];
export const NO_DIFF_PROGRAM_FLAGS = ['--no-ext-diff', '--no-textconv'];

/**
 * Programs that can run other programs or change files, so one "always allow" must never turn
 * into a wildcard for them: `find` has `-exec` and `-delete`, `npx` runs any package, `sed -i`
 * edits. They are kept as the exact command the user approved. The `python` family (`python3`,
 * `python3.12`) is matched by pattern in `program.utils.ts`.
 */
export const EXACT_ONLY_PROGRAMS: readonly string[] = [
  'find',
  'xargs',
  'npx',
  'env',
  'sh',
  'bash',
  'zsh',
  'sed',
  'awk',
  'perl',
  'python',
  'node',
  'ruby',
  'make',
  'rsync',
  'tar',
  'curl',
  'wget',
  'ssh',
  'scp',
  'sudo',
];

/**
 * Searchers that read file contents and can neither run a program nor write: for them a second
 * word is a flag or a pattern, never a subcommand, so "always allow" keeps `grep *`. Only GNU/BSD
 * `grep` and its aliases: `rg --pre` and `ag`/`ack --pager` run a program, so they are not here.
 */
export const SEARCHERS: readonly string[] = ['grep', 'egrep', 'fgrep'];

/**
 * Added after a searcher's own arguments, so they win over any `--include` the command has
 * (the last matching one decides): without them a recursive `grep -r KEY .` reads every `.env`
 * file under the folder, which the file tools refuse by name. Written case-insensitively, as
 * `isEnvFile` is.
 */
export const NO_ENV_SEARCH_FLAGS = ['--exclude=.[eE][nN][vV]', '--exclude=.[eE][nN][vV].*'];
