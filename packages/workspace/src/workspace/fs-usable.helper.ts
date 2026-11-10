import type { Stats } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { PathCheckError } from '../errors/workspace.errors.js';
import { UNUSABLE_ENTRY_CODES } from './worktrees.constants.js';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';

/**
 * Runs a filesystem check on `file`. Gone, unreadable, looping or an impossible name means the
 * entry is unusable (undefined); any other failure is a `PathCheckError`, never "fine".
 */
async function ifUsable<T>(params: {
  file: string;
  run: () => Promise<T>;
}): Promise<T | undefined> {
  const { file, run } = params;

  try {
    return await run();
  } catch (caughtError) {
    // Only the codes in UNUSABLE_ENTRY_CODES say "not a usable worktree"; the rest is unchecked.
    const code = errorCode(caughtError);

    if (code !== undefined && UNUSABLE_ENTRY_CODES.includes(code)) return undefined;
    throw new PathCheckError({ path: file, cause: caughtError });
  }
}

/** The real path of `file`, or undefined when it can't be used. */
export function realPathIfUsable(file: string): Promise<string | undefined> {
  return ifUsable({ file, run: () => realpath(file) });
}

/** The text of `file`, or undefined when it can't be used. */
export function readTextIfUsable(file: string): Promise<string | undefined> {
  return ifUsable({ file, run: () => readFile(file, 'utf8') });
}

/** The stats of `file` itself (a symlink is not followed), or undefined when it can't be used. */
export function lstatIfUsable(file: string): Promise<Stats | undefined> {
  return ifUsable({ file, run: () => lstat(file) });
}
