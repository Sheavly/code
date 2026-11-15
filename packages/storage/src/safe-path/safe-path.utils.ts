import path from 'node:path';
import type { z } from 'zod';
import { lowercaseUuidSchema } from '@sheavly/protocol/id/id.validator';
import { PLAIN_EXTENSION } from './safe-path.constants.js';

/** Whether `candidate` is the top of a file system (`/`, `C:\`), where `dirname` goes no higher. */
export function isFilesystemRoot(candidate: string): boolean {
  return path.dirname(candidate) === candidate;
}

/**
 * Why `root` is no place for a store to keep things, or `undefined` when it is. A path that is not
 * absolute is taken from wherever the process happens to run, so the same store would be in
 * another place after a `cd`; and the top of a file system is a place nothing of ours belongs.
 * Pure.
 */
export function unsafeRootReason(root: string): string | undefined {
  if (!path.isAbsolute(root)) {
    return 'a path that is not absolute would be taken from wherever the process runs';
  }

  if (isFilesystemRoot(path.resolve(root))) return 'it is the root of a file system';

  return undefined;
}

/**
 * Why `<name><extension>` is not a name a store may give a file or folder, or `undefined` when it
 * is. `name` is taken as the plain string it is: a type that says it is an id proves nothing about
 * a value that came from outside, so only what `shape` accepts passes (by default a lowercase
 * UUID: no separator, no `..`, no reserved name), and `extension` must be empty or a short plain
 * suffix like `.json`. A folder named by something else with a precise shape, like a workspace
 * key, passes that shape. Pure.
 */
export function unsafeNameReason(params: {
  name: string;
  extension?: string;
  shape?: z.ZodType<string>;
}): string | undefined {
  const { name, extension = '', shape = lowercaseUuidSchema } = params;

  if (!shape.safeParse(name).success) return 'its name is not an id';

  if (extension !== '' && !PLAIN_EXTENSION.test(extension)) {
    return 'its extension is not a plain suffix like .json';
  }

  return undefined;
}

/**
 * Why `folder` must not be deleted as one of `root`'s folders, or `undefined` when it may. Only a
 * folder named by an id directly inside `root` passes, so nothing that holds anything else, a
 * typo'd or empty path included, is ever deleted. Pure: it looks at the paths, not the disk.
 * `home` is the user's home folder.
 *
 * Paths are resolved first (`..` applied), so what is checked is what would be deleted.
 */
export function unsafeRemovalReason(params: {
  root: string;
  folder: string;
  home: string;
}): string | undefined {
  const { root, folder, home } = params;

  if (!path.isAbsolute(folder)) return unsafeRootReason(folder);

  const target = path.resolve(folder);
  const parent = path.resolve(root);

  const rootReason = unsafeRootReason(root);

  if (rootReason) return rootReason;

  if (path.dirname(target) !== parent) return 'it is not directly inside its store’s folder';

  const nameReason = unsafeNameReason({ name: path.basename(target) });

  if (nameReason) return `${nameReason}, so it is not one a store made`;

  if (contains({ outer: target, inner: path.resolve(home) })) {
    return 'it is, or holds, the home folder';
  }

  return undefined;
}

/** Whether `inner` is `outer` or somewhere inside it. */
function contains(params: { outer: string; inner: string }): boolean {
  const relative = path.relative(params.outer, params.inner);
  const outside = relative === '..' || relative.startsWith(`..${path.sep}`);

  return !outside && !path.isAbsolute(relative);
}
