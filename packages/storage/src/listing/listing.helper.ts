import { readdir } from 'node:fs/promises';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { StorageFileError } from '../errors/storage.errors.js';

/**
 * The names of the folders in `folder` that could be a store's items, in a fixed order: `readdir`'s
 * is the system's. Hidden entries (macOS and editors leave them) and files are skipped; a link to a
 * folder counts only with `followLinks`, for a store that may be kept in a synced folder. No folder
 * yet is none. Throws a `StorageFileError` naming `folder` when it can't be read.
 */
export async function listFolderNames(params: {
  folder: string;
  followLinks?: boolean;
}): Promise<string[]> {
  const { folder, followLinks = false } = params;
  let entries;

  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return [];
    throw new StorageFileError({ file: folder, cause: caughtError });
  }

  return entries
    .filter((entry) => !entry.name.startsWith('.'))
    .filter((entry) => entry.isDirectory() || (followLinks && entry.isSymbolicLink()))
    .map((entry) => entry.name)
    .sort();
}
