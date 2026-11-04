import path from 'node:path';
import { lowercaseUuidSchema } from '@sheavly/protocol/id/id.validator';

/** The suffix of a file a store names: a dot and a few lowercase letters (`.json`, `.jsonl`). */
const PLAIN_EXTENSION = /^\.[a-z]{1,8}$/;

/**
 * Why `folder` must not be deleted as one of `root`'s folders, or `undefined` when it may. Only a
 * folder named by an id (a lowercase UUID, which every store names its folders by) directly inside
 * `root` passes, so nothing that holds anything else, a typo'd or empty path included, is ever
 * deleted. Pure: it looks at the paths, not the disk. `home` is the user's home folder.
 *
 * Paths are resolved first (`..` applied), so what is checked is what would be deleted.
 */
export function unsafeRemovalReason(params: {
  root: string;
  folder: string;
  home: string;
}): string | undefined {
  const { root, folder, home } = params;

  if (!path.isAbsolute(root) || !path.isAbsolute(folder)) {
    return 'a path that is not absolute would be taken from wherever the process runs';
  }

  const target = path.resolve(folder);
  const parent = path.resolve(root);

  if (isFilesystemRoot(parent)) return 'its folder is the root of a file system';
  if (path.dirname(target) !== parent) return 'it is not directly inside its store’s folder';

  if (!lowercaseUuidSchema.safeParse(path.basename(target)).success) {
    return 'its name is not an id, so it is not one a store made';
  }

  if (contains({ outer: target, inner: path.resolve(home) })) {
    return 'it is, or holds, the home folder';
  }

  return undefined;
}

/** Whether `candidate` is the top of a file system (`/`, `C:\`), where `dirname` goes no higher. */
export function isFilesystemRoot(candidate: string): boolean {
  return path.dirname(candidate) === candidate;
}

/**
 * Why the file `<id><extension>` must not be deleted from `folder`, or `undefined` when it may.
 * `id` is taken as the plain string it is: a type that says it is an id proves nothing about a
 * value that came from outside, so only a lowercase UUID passes (no separator, no `..`, no
 * reserved name), and `extension` must be a short plain suffix like `.json`. Pure.
 */
export function unsafeFileRemovalReason(params: {
  folder: string;
  id: string;
  extension: string;
}): string | undefined {
  const { folder, id, extension } = params;

  if (!path.isAbsolute(folder)) {
    return 'a folder that is not absolute would be taken from wherever the process runs';
  }

  if (isFilesystemRoot(path.resolve(folder))) return 'its folder is the root of a file system';
  if (!lowercaseUuidSchema.safeParse(id).success) return 'its name is not an id';

  if (!PLAIN_EXTENSION.test(extension)) {
    return 'its extension is not a plain suffix like .json';
  }

  return undefined;
}

/** Whether `inner` is `outer` or somewhere inside it. */
function contains(params: { outer: string; inner: string }): boolean {
  const relative = path.relative(params.outer, params.inner);
  const outside = relative === '..' || relative.startsWith(`..${path.sep}`);

  return !outside && !path.isAbsolute(relative);
}
