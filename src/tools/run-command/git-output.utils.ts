/**
 * Which git commands can print or write file contents. A blocklist of patch flags always misses
 * one (`--patch-with-stat`, `status -v`, `-G` guesses), so this is an allowlist: a git command
 * runs without asking only when every flag is one known to show no file contents, and a diff
 * also asks for a summary. Anything else needs the user's approval. Pure helpers;
 * `arguments.helper.ts` turns the result into approval concerns.
 */
import type { ApprovalConcern } from '../../runtime/approvals/approvals.types.js';

/** Long flags (the part before `=`) that show no file contents, per subcommand. */
const SAFE_LONG: Record<string, ReadonlySet<string>> = {
  status: new Set([
    '--short',
    '--branch',
    '--porcelain',
    '--long',
    '--untracked-files',
    '--ignored',
    '--ignore-submodules',
    '--show-stash',
    '--ahead-behind',
    '--no-ahead-behind',
    '--renames',
    '--no-renames',
    '--column',
    '--no-column',
  ]),
  log: new Set([
    '--oneline',
    '--max-count',
    '--skip',
    '--since',
    '--until',
    '--after',
    '--before',
    '--author',
    '--committer',
    '--all',
    '--branches',
    '--tags',
    '--remotes',
    '--graph',
    '--decorate',
    '--no-decorate',
    '--abbrev-commit',
    '--no-merges',
    '--merges',
    '--first-parent',
    '--reverse',
    '--date',
    '--format',
    '--pretty',
    '--follow',
    '--stat',
    '--shortstat',
    '--numstat',
    '--name-only',
    '--name-status',
  ]),
  diff: new Set([
    '--stat',
    '--shortstat',
    '--numstat',
    '--dirstat',
    '--name-only',
    '--name-status',
    '--cached',
    '--staged',
    '--quiet',
  ]),
};
/** Short flags that show no file contents, per subcommand (`-sb`, `-n5`, `-20`). */
const SAFE_SHORT: Record<string, RegExp> = {
  status: /^-[sbuz]+$/,
  log: /^-(n\d*|\d+)$/,
  diff: /^$/,
};
/** A diff without one of these is a patch. */
const DIFF_SUMMARY = new Set([
  '--stat',
  '--shortstat',
  '--numstat',
  '--dirstat',
  '--name-only',
  '--name-status',
  '--quiet',
]);

const PRINTS_CONTENTS = 'can print file contents, including a committed .env file';

/**
 * Why this git command needs approval for what it prints or writes, or [] for one that shows no
 * file contents (`git status -sb`, `git log --oneline -n 5`, `git diff --stat HEAD~1`). `args`
 * are the words after `git`. Other commands get [].
 */
export function gitOutputConcerns(params: {
  file: string;
  args: readonly string[];
}): ApprovalConcern[] {
  const { file, args } = params;
  const [subcommand = '', ...rest] = args;

  if (file !== 'git') return [];

  const safeLong = SAFE_LONG[subcommand];
  const safeShort = SAFE_SHORT[subcommand];

  if (!safeLong || !safeShort) return [{ argument: subcommand, reason: PRINTS_CONTENTS }];

  const flags = rest
    .slice(0, rest.includes('--') ? rest.indexOf('--') : undefined)
    .filter((arg) => arg.startsWith('-'));
  const unsafe = flags.filter((flag) =>
    flag.startsWith('--') ? !safeLong.has(flag.split('=')[0] ?? flag) : !safeShort.test(flag),
  );
  const concerns = unsafe.map((flag) => ({ argument: flag, reason: PRINTS_CONTENTS }));

  if (
    subcommand === 'diff' &&
    !flags.some((flag) => DIFF_SUMMARY.has(flag.split('=')[0] ?? flag))
  ) {
    concerns.push({ argument: 'diff', reason: `${PRINTS_CONTENTS} (a diff is a patch)` });
  }

  return concerns;
}
