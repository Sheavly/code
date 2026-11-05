/**
 * Commands `run_command` runs without asking, in every folder: they only read. The user's own
 * allow list (their "always allow" answers) comes on top of these.
 *
 * Each entry is a command written as words:
 *   "git status"   allows exactly `git status`
 *   "git diff *"   allows `git diff` followed by any arguments
 *
 * Nothing here can write a file or run a program the agent could have written: no `sort` or
 * `uniq` (they take an output file), no `rg` (`--pre` runs a program), no test runner (it runs
 * the repo's own scripts, which the agent can edit). The arguments of these are still checked.
 */
export const BUILT_IN_ALLOW = [
  'ls *',
  'pwd',
  'git status *',
  'git diff *',
  'git log *',
  'head *',
  'tail *',
  'wc *',
] as const;
