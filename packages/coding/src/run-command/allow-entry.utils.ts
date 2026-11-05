// How many leading words name what a runner runs, so an entry keeps them: `npm run test` is a
// script, `node build.mjs` a file, `npx vitest` a package. `git log` and the like need only two.
const WORDS_TO_KEEP: Readonly<Record<string, number>> = {
  npm: 2,
  node: 2,
  python: 2,
  python3: 2,
  make: 2,
  npx: 2,
};
const RUN_SCRIPT = 3;
const DEFAULT_WORDS = 2;

function wordsToKeep(argv: readonly string[]): number {
  if (argv[0] === 'npm' && (argv[1] === 'run' || argv[1] === 'run-script')) return RUN_SCRIPT;

  return WORDS_TO_KEEP[argv[0] ?? ''] ?? DEFAULT_WORDS;
}

// A word the entry format can't carry: it is split on whitespace, and `*` ends an entry.
const UNWRITABLE = /\s|^\*$/;

/**
 * The allow-list entry "always allow" stores for a command the user approved, or undefined when
 * no entry can say it. The first two words, then `*` for any arguments: `git log --oneline`
 * becomes `git log *`. A runner keeps the word that says what it runs (`npm run test *`). When the
 * second word is a flag (`git -c core.pager=x log`), the command could mean anything, so only
 * that exact command is stored.
 */
export function suggestEntry(argv: readonly string[]): string | undefined {
  if (argv.length === 0 || argv.some((word) => UNWRITABLE.test(word) || word === '')) {
    return undefined;
  }

  if (argv[1]?.startsWith('-')) return argv.join(' ');

  const kept = argv.slice(0, wordsToKeep(argv));

  return argv.length > kept.length ? `${kept.join(' ')} *` : kept.join(' ');
}
