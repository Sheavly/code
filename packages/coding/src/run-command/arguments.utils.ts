/**
 * Which words of an allow-listed command may name files, and whether one can name a `.env` file.
 * Pure helpers; the workspace checks are in `arguments.helper.ts`.
 */
import { isEnvFile } from '../files/files.utils.js';

/**
 * The arguments that may be paths: operands, the value of `--opt=value`, the value attached to a
 * short option (`-O../x`, `-L1,5:.env`), and every word after `--` (git pathspecs). Other flags
 * (`--stat`) are skipped.
 */
export function pathArguments(args: readonly string[]): string[] {
  const paths: string[] = [];
  let afterDashes = false;

  for (const arg of args) {
    if (afterDashes || !arg.startsWith('-')) paths.push(arg);
    else if (arg === '--') afterDashes = true;
    else if (arg.includes('=')) paths.push(arg.slice(arg.indexOf('=') + 1));
    else if (!arg.startsWith('--')) paths.push(arg.slice(2)); // `-la` gives `a`: harmless
  }

  return paths.filter((arg) => arg !== '');
}

/** Drops git pathspec magic: `:(top).env`, `:/.env`, `:!x` → `.env`, `.env`, `x`. */
export function stripPathspecMagic(arg: string): string {
  return arg.replace(/^:(\([^)]*\)|[/!^]*)/, '');
}

/**
 * True if `arg` can name a `.env` file: directly (`.env`, `config/.env.local`), as a git
 * `<revision>:<path>` (`HEAD:.env`), escaped (`.\env`), or as any glob. Git's `*`, `?` and
 * `[...]` cross `/`, so no glob can be ruled out (`c*`, `con?ig/.e*` reach `config/.env`).
 */
export function namesEnvFile(arg: string): boolean {
  // A backslash makes the next character literal to git: `.\env` is `.env`.
  const spec = stripPathspecMagic(arg).replaceAll('\\', '');
  const afterRevision = spec.slice(spec.lastIndexOf(':') + 1);

  return /[*?[]/.test(spec) || [spec, afterRevision].some((part) => isEnvFile(part));
}
