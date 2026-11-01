import path from 'node:path';

/** True for `.env`, `.env.local`, `.env.production`, ... (case-insensitive). */
export function isEnvFile(filePath: string): boolean {
  return /^\.env(\..*)?$/i.test(path.basename(filePath));
}

/** True if any part of `filePath` is `.git` (case-insensitive): `.git/config`, `sub/.git`. */
function isInGitDir(filePath: string): boolean {
  return filePath.split(/[\\/]/).some((part) => part.toLowerCase() === '.git');
}

/**
 * Throws if `relativePath` (relative to the workspace root) is in a `.git` folder or is a
 * `.git` file. Git config and hooks there can make the next `git status` run any program.
 */
export function assertNotGitDir(params: { relativePath: string; requested: string }): void {
  const { relativePath, requested } = params;

  if (isInGitDir(relativePath)) {
    throw new Error(
      `Writing inside .git is not allowed (${requested}). Git config and hooks there can run ` +
        'programs.',
    );
  }
}

/**
 * Throws if `filePath` is a .env file; `requested` is what the model asked for, for the error.
 * `action` names what was refused, e.g. "Reading" or "Writing".
 */
export function assertNotEnvFile(params: {
  filePath: string;
  requested: string;
  action: string;
}): void {
  const { filePath, requested, action } = params;

  if (isEnvFile(filePath)) {
    throw new Error(`${action} .env files is not allowed (${requested}). They contain secrets.`);
  }
}

/** How many times `search` occurs in `text` (non-overlapping). */
export function countOccurrences(params: { text: string; search: string }): number {
  const { text, search } = params;

  return search === '' ? 0 : text.split(search).length - 1;
}

/** A short summary of a change, for the model: e.g. "Edited src/a.ts (+3 −1 lines)". */
export function describeChange(params: {
  verb: string;
  path: string;
  before: string | null;
  after: string;
}): string {
  const { verb, path: file, before, after } = params;
  const lines = (text: string | null) =>
    text === null || text === '' ? 0 : text.split('\n').length;

  return `${verb} ${file} (${lines(before)} → ${lines(after)} lines)`;
}
