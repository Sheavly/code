import { realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { StorageFileError, UnsafeRemovalError } from '../errors/storage.errors.js';
import { RM_RETRIES, RM_RETRY_DELAY_MS } from './folder.constants.js';
import { isFilesystemRoot, unsafeFileRemovalReason, unsafeRemovalReason } from './folder.utils.js';

/**
 * Deletes `folder` and everything in it, but only a folder a store made: one named by an id (a
 * lowercase UUID) directly inside `root`, the store's own folder. Anything else throws an
 * `UnsafeRemovalError` and nothing is touched: an empty, relative or mistyped path, `root` itself,
 * the home folder, a folder above it, or a file system's top must never reach a recursive delete.
 *
 * A folder that is not there is fine. `folder` that is a symbolic link is removed as the link
 * only, never its target's contents, and no link inside is followed. A `root` that is a link is
 * followed to where it really is, and that must not be a file system's top either. Throws a
 * `StorageFileError` naming the folder when it can't be removed. `home` is for a test; it defaults
 * to the user's home folder.
 */
export async function removeFolder(params: {
  root: string;
  folder: string;
  home?: string;
}): Promise<void> {
  const { root, folder, home = homedir() } = params;
  const reason = unsafeRemovalReason({ root, folder, home });

  if (reason) throw new UnsafeRemovalError({ target: folder, reason });

  // What is deleted is what was checked: the path with its `..` applied, not as it was written.
  const target = path.resolve(folder);

  await assertRealRootIsSafe({ root, target: folder });

  try {
    await rm(target, {
      recursive: true,
      force: true,
      maxRetries: RM_RETRIES,
      retryDelay: RM_RETRY_DELAY_MS,
    });
  } catch (caughtError) {
    throw new StorageFileError({ file: target, cause: caughtError });
  }
}

/**
 * Deletes the one file `<folder>/<id><extension>`, and nothing else: `id` must be a lowercase UUID
 * and `extension` a plain suffix (`.json`), so a value that came from outside can't name another
 * file, or climb out of `folder`, whatever its type says. The path is built here, not handed in.
 * Never recursive: if that name is a folder it is left alone and this throws. A file that is not
 * there is fine. Throws an `UnsafeRemovalError` for a refused name (nothing is touched) and a
 * `StorageFileError` naming the file when it can't be removed.
 */
export async function removeFile(params: {
  folder: string;
  id: string;
  extension: string;
}): Promise<void> {
  const { folder, id, extension } = params;
  const file = path.join(folder, `${id}${extension}`);
  const reason = unsafeFileRemovalReason({ folder, id, extension });

  if (reason) throw new UnsafeRemovalError({ target: file, reason });

  await assertRealRootIsSafe({ root: folder, target: file });

  try {
    await rm(file, { force: true });
  } catch (caughtError) {
    throw new StorageFileError({ file, cause: caughtError });
  }
}

/** A store's folder reached through a link must not really be the top of a file system. */
async function assertRealRootIsSafe(params: { root: string; target: string }): Promise<void> {
  const { root, target } = params;
  let real: string;

  try {
    real = await realpath(root);
  } catch (caughtError) {
    // No folder yet means nothing is stored in it, and so nothing to remove.
    if (isMissingPath(caughtError)) return;
    throw new StorageFileError({ file: root, cause: caughtError });
  }

  if (isFilesystemRoot(real)) {
    throw new UnsafeRemovalError({ target, reason: `its store’s folder really is ${real}` });
  }
}
