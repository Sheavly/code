import { realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { z } from 'zod';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { StorageFileError, UnsafePathError } from '../errors/storage.errors.js';
import { RM_RETRIES, RM_RETRY_DELAY_MS } from './safe-path.constants.js';
import {
  isFilesystemRoot,
  unsafeNameReason,
  unsafeRemovalReason,
  unsafeRootReason,
} from './safe-path.utils.js';

/**
 * Checks the folder a store keeps its things in, when the store is built: it must be absolute and
 * not the top of a file system. A relative one would silently mean "wherever the process runs", so
 * the same store would read and write somewhere else after a `cd`. Returns `root` for use in a
 * field initialiser. Throws an `UnsafePathError`.
 */
export function assertSafeRoot(root: string): string {
  const reason = unsafeRootReason(root);

  if (reason) throw new UnsafePathError({ target: root, reason });

  return root;
}

/**
 * The path of `<name><extension>` inside `folder`, for a store to read, write or delete, so every
 * file it names is made one way. `name` must be a lowercase UUID (or match `shape`, for a name with
 * its own precise form, like a workspace key) and `extension` empty or a plain suffix (`.json`): a
 * value that came from outside can't name another file, or climb out of `folder`, whatever its
 * type says. `folder` must be absolute and not the top of a file system. Throws an
 * `UnsafePathError`, before anything is touched.
 */
export function namedPath(params: {
  folder: string;
  name: string;
  extension?: string;
  shape?: z.ZodType<string>;
}): string {
  const { folder, name, extension = '', shape } = params;
  const target = path.join(folder, `${name}${extension}`);
  const reason =
    unsafeRootReason(folder) ?? unsafeNameReason({ name, extension, ...(shape && { shape }) });

  if (reason) throw new UnsafePathError({ target, reason });

  return target;
}

/**
 * Deletes `folder` and everything in it, but only a folder a store made: one named by an id (a
 * lowercase UUID) directly inside `root`, the store's own folder. Anything else throws an
 * `UnsafePathError` and nothing is touched: an empty, relative or mistyped path, `root` itself,
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

  if (reason) throw new UnsafePathError({ target: folder, reason });

  // What is deleted is what was checked: the path with its `..` applied, not as it was written.
  const target = path.resolve(folder);

  await assertRealFolderIsSafe({ folder: root, target: folder });

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
 * Deletes the one file `<folder>/<id><extension>` (see `namedPath` for what it accepts, `shape`
 * included, for a name with its own precise form), and nothing else. Never recursive: if that name is a folder it is left alone and this throws. A file
 * that is not there is fine. Throws an `UnsafePathError` for a refused name (nothing is touched)
 * and a `StorageFileError` naming the file when it can't be removed.
 */
export async function removeFile(params: {
  folder: string;
  name: string;
  extension: string;
  shape?: z.ZodType<string>;
}): Promise<void> {
  const { folder, name, extension, shape } = params;
  const file = namedPath({ folder, name, extension, ...(shape && { shape }) });

  await assertRealFolderIsSafe({ folder, target: file });

  try {
    await rm(file, { force: true });
  } catch (caughtError) {
    throw new StorageFileError({ file, cause: caughtError });
  }
}

/** A store's folder reached through a link must not really be the top of a file system. */
async function assertRealFolderIsSafe(params: { folder: string; target: string }): Promise<void> {
  const { folder, target } = params;
  let real: string;

  try {
    real = await realpath(folder);
  } catch (caughtError) {
    // No folder yet means nothing is stored in it, and so nothing to remove.
    if (isMissingPath(caughtError)) return;
    throw new StorageFileError({ file: folder, cause: caughtError });
  }

  if (isFilesystemRoot(real)) {
    throw new UnsafePathError({ target, reason: `its store’s folder really is ${real}` });
  }
}
