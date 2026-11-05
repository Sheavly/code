import { EXACT_ONLY_PROGRAMS, SEARCHERS } from './run-command.constants.js';

const PYTHON = /^python[\d.]*$/;

/**
 * The program a command word names, without its folder or `.exe`, in lower case: `/usr/bin/find`,
 * `./find` and `Find.EXE` are all `find`. Pure.
 */
export function programName(word: string): string {
  return (word.split(/[\\/]/).at(-1) ?? word).replace(/\.exe$/i, '').toLowerCase();
}

/** Whether `word` is a bare name, found through the PATH, not a path to a file (`./grep`). */
export function isBareName(word: string): boolean {
  return !/[\\/]/.test(word);
}

/**
 * Whether this command can run other programs or change files, so a wildcard for it would allow
 * far more than the user approved. Matches by name wherever the program lives (`/usr/bin/find`
 * counts), since a path must not be a way around the list; and `npm exec` / `npm x`, which are
 * `npx` by another name.
 */
export function runsOtherPrograms(argv: readonly string[]): boolean {
  const name = programName(argv[0] ?? '');

  if (EXACT_ONLY_PROGRAMS.includes(name) || PYTHON.test(name)) return true;

  return name === 'npm' && (argv[1] === 'exec' || argv[1] === 'x');
}

/**
 * Whether this command is one of the read-only searchers (`grep`). Only a bare name counts: a
 * `./grep` is a file in the folder that the agent could have written, not the program.
 */
export function isSearcher(argv: readonly string[]): boolean {
  const word = argv[0] ?? '';

  return isBareName(word) && SEARCHERS.includes(programName(word));
}

/** Whether `file` is a searcher by name, wherever it lives, for the `.env` guard on its arguments. */
export function searchesFiles(file: string): boolean {
  return SEARCHERS.includes(programName(file));
}
