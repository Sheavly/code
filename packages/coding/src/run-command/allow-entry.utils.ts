import { runsOtherPrograms, isSearcher } from './program.utils.js';

// `npm run <script>` names a script, so an entry keeps it: `npm run test *`. Anything else keeps
// the program and its subcommand: `git log *`.
const RUN_SCRIPT = 3;
const DEFAULT_WORDS = 2;

function wordsToKeep(argv: readonly string[]): number {
  if (argv[0] === 'npm' && (argv[1] === 'run' || argv[1] === 'run-script')) return RUN_SCRIPT;

  return DEFAULT_WORDS;
}

// A word the entry format can't carry: it is split on whitespace, and `*` ends an entry.
const UNWRITABLE = /\s|^\*$/;

/**
 * The allow-list entry "always allow" stores for a command the user approved, or undefined when
 * no entry can say it. Never wider than what the user can tell they are agreeing to:
 *
 * - A program that can run other programs or change files (`find`, `npx`, `sed`, `node`, ... see
 *   `EXACT_ONLY_PROGRAMS`) keeps the exact command, since a wildcard would allow `find -exec`
 *   after one approved `find`.
 * - A searcher (`grep`) keeps `grep *`: its second word is a flag or a pattern, never a
 *   subcommand, so two words would match one search and nothing else.
 * - Otherwise the first two words, then `*` for any arguments: `git log --oneline` becomes
 *   `git log *`. `npm run <script>` keeps the script (`npm run test *`). When the second word is a
 *   flag (`git -c core.pager=x log`) the command could mean anything, so only that exact command.
 */
export function suggestEntry(argv: readonly string[]): string | undefined {
  if (argv.length === 0 || argv.some((word) => UNWRITABLE.test(word) || word === '')) {
    return undefined;
  }

  const [program = ''] = argv;

  if (runsOtherPrograms(argv)) return argv.join(' ');
  if (isSearcher(argv)) return argv.length > 1 ? `${program} *` : program;
  if (argv[1]?.startsWith('-')) return argv.join(' ');

  const kept = argv.slice(0, wordsToKeep(argv));

  return argv.length > kept.length ? `${kept.join(' ')} *` : kept.join(' ');
}
