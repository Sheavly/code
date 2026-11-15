import { constants } from 'node:fs';
import { lstat, mkdir, open, rm, stat, writeFile, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { MAX_FILE_BYTES } from './files.constants.js';

/**
 * The file's current content, or `null` if it doesn't exist. It is read through `openRegularFile`,
 * so a FIFO, a device or a path swapped for a symlink is refused instead of read.
 */
async function readIfExists(params: {
  file: string;
  requested: string;
  signal: AbortSignal;
}): Promise<string | null> {
  const { file, requested, signal } = params;
  let handle: FileHandle;

  try {
    handle = await openRegularFile({ file, requested });
  } catch (caughtError) {
    if ((caughtError as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw caughtError;
  }

  try {
    return await handle.readFile({ encoding: 'utf8', signal });
  } finally {
    await handle.close();
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
  const before = await readIfExists({ file, requested, signal });

  if (before === null) {
    throw new ToolCallError({
      reason: 'not_found',
      message: `File not found: ${requested}. ${hint}`,
    });
  }

  return before;
}

/**
 * Refuses a file bigger than `MAX_FILE_BYTES`, judged from its size on disk before any content is
 * read. A file that is not there is left for the read that follows to report as `not_found`.
 */
export async function assertFitsInMemory(params: {
  file: string;
  requested: string;
  hint: string;
}): Promise<void> {
  const { file, requested, hint } = params;
  let size: number;

  try {
    size = await fileSize({ file });
  } catch (caughtError) {
    if ((caughtError as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw caughtError;
  }

  if (size > MAX_FILE_BYTES) {
    throw new ToolCallError({
      reason: 'invalid_input',
      message: `${requested} is ${size} bytes, more than the ${MAX_FILE_BYTES} bytes a file tool handles. ${hint}`,
    });
  }
}

/** Refuses text that would make a file bigger than `MAX_FILE_BYTES`. */
export function assertContentFits(params: { content: string; requested: string }): void {
  const { content, requested } = params;
  const size = Buffer.byteLength(content, 'utf8');

  if (size > MAX_FILE_BYTES) {
    throw new ToolCallError({
      reason: 'invalid_input',
      message: `The content for ${requested} is ${size} bytes, more than the ${MAX_FILE_BYTES} bytes a file tool handles. Split it across files.`,
    });
  }
}

/**
 * Opens `file` for reading without following a symlink at its last component, and refuses anything
 * but a regular file or a file that is not the one `file` named when the guard resolved it
 * (swapped between the guard and the open). `O_NONBLOCK` makes opening a FIFO return at once, so
 * the regular-file check can refuse it: without it the open waits for a writer in the thread pool,
 * holds the file's lock and cannot be aborted. It has no effect on a regular file. A folder on the
 * way to the file swapped in that last moment is the one case Node can't close without `openat`
 * (on Windows `O_NOFOLLOW` does not exist and the `dev`/`ino` comparison is the only guard). The
 * caller closes the handle.
 */
export async function openRegularFile(params: {
  file: string;
  requested: string;
}): Promise<FileHandle> {
  const { file, requested } = params;
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

  try {
    const [opened, named] = await Promise.all([handle.stat(), lstat(file)]);

    if (!opened.isFile()) {
      throw new ToolCallError({
        reason: 'invalid_input',
        message: `${requested} is not a regular file, so a file tool can't use it.`,
      });
    }

    if (opened.dev !== named.dev || opened.ino !== named.ino) {
      throw new ToolCallError({
        reason: 'forbidden',
        message: `${requested} changed while it was being opened. Try again.`,
      });
    }
  } catch (caughtError) {
    await handle.close();
    throw caughtError;
  }

  return handle;
}

/** The file's size in bytes. */
export async function fileSize(params: { file: string }): Promise<number> {
  const stats = await stat(params.file);

  return stats.size;
}

/**
 * Writes UTF-8 text. With `create` the file must not exist: it is opened exclusively (`wx`), which
 * refuses an existing path and a symlink put there since the check, so a create never writes
 * through a link. Without it the existing file is replaced.
 */
export async function writeText(params: {
  file: string;
  content: string;
  signal: AbortSignal;
  create?: boolean;
}): Promise<void> {
  const { file, content, signal, create = false } = params;

  await writeFile(file, content, { encoding: 'utf8', signal, ...(create && { flag: 'wx' }) });
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
