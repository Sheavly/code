import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';

/** The file's current content, or `null` if it doesn't exist yet. */
export async function readIfExists(params: {
  file: string;
  signal: AbortSignal;
}): Promise<string | null> {
  const { file, signal } = params;

  try {
    return await readFile(file, { encoding: 'utf8', signal });
  } catch (caughtError) {
    if ((caughtError as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw caughtError;
  }
}

/**
 * The content of a file the change expects to exist, read under its lock. A missing file fails as
 * `not_found`, with `hint` saying what to do instead: creating it, or looking for the delete that
 * already happened.
 */
export async function readForChange(params: {
  file: string;
  requested: string;
  signal: AbortSignal;
  hint: string;
}): Promise<string> {
  const { file, requested, signal, hint } = params;
  const before = await readIfExists({ file, signal });

  if (before === null) {
    throw new ToolCallError({
      reason: 'not_found',
      message: `File not found: ${requested}. ${hint}`,
    });
  }

  return before;
}

/** The file's size in bytes. */
export async function fileSize(params: { file: string }): Promise<number> {
  const stats = await stat(params.file);

  return stats.size;
}

/** Writes UTF-8 text. */
export async function writeText(params: {
  file: string;
  content: string;
  signal: AbortSignal;
}): Promise<void> {
  const { file, content, signal } = params;

  await writeFile(file, content, { encoding: 'utf8', signal });
}

/** Creates the folders a file's path needs, so a file can be written into them. */
export async function createParentFolder(params: { file: string }): Promise<void> {
  await mkdir(path.dirname(params.file), { recursive: true });
}

/**
 * Removes one file, unless the call was aborted first: the unlink is the one step that cannot be
 * undone, so a cancelled turn must not reach it. A path that is already gone fails with ENOENT, so
 * nothing pretends to have deleted what it did not; a folder is never removed (`rm` without
 * `recursive` refuses one). Node's `rm` takes no abort signal itself: removing one file is a single
 * call, so an abort can only land before it, which the check covers. Windows can hold a file
 * briefly after another handle closes, so `rm` retries the errors that reports instead of failing.
 */
export async function removeFile(params: { file: string; signal: AbortSignal }): Promise<void> {
  const { file, signal } = params;

  signal.throwIfAborted();
  await rm(file, { maxRetries: 3, retryDelay: 100 });
}
