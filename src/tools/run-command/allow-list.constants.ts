/**
 * Allow list for run_command.
 *
 * Each entry is a command written as words:
 *   "git status"   allows exactly `git status`
 *   "git diff *"   allows `git diff` followed by any arguments
 */
export const DEFAULT_ALLOW_LIST = [
  'ls *',
  'pwd',
  'git status *',
  'git diff *',
  'git log *',
  'npm test *',
  'npm run typecheck',
  'npx vitest run *',
  'npx tsc --noEmit',
];
