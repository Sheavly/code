import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { isInside } from '@sheavly/workspace/workspace/workspace.utils';
import { isEnvironmentError } from './environment-error.utils.js';

/**
 * The real path of `target`, or `undefined` when the system cannot resolve it (missing, a link
 * loop, no permission): such a path is no folder this can say anything about, and the caller's
 * own read reports a file in it. A failure that is not a system error is thrown.
 */
async function realPathIfResolvable(target: string): Promise<string | undefined> {
  try {
    return await realpath(target);
  } catch (caughtError) {
    if (isEnvironmentError(caughtError)) return undefined;
    throw caughtError;
  }
}

/**
 * Whether `<workspaceRoot>/.sheavly` is the user's own folder: it is `home` (the user's
 * `SHEAVLY_HOME`) or holds it, so the workspace is the user's home, or a folder whose `.sheavly`
 * is the user's folder. A workspace that is only a parent of the home (`/home` for `~/.sheavly`)
 * is not caught, as its own `.sheavly` is not the user's. Compared by real path and by path
 * segments, never by string prefix, so a link to the folder counts and `.sheavlyfoo` next to
 * `.sheavly` does not. Such a folder is not a project's: its global and
 * profile files are the user's layers already, and its trust store would sit inside the workspace.
 * A `.sheavly` that is not there or cannot be resolved is not the user's; a `home` that cannot be
 * resolved is compared as given.
 */
export async function isUserFolder(params: {
  workspaceRoot: string;
  home: string;
}): Promise<boolean> {
  const dir = await realPathIfResolvable(path.join(path.resolve(params.workspaceRoot), '.sheavly'));

  if (dir === undefined) return false;

  const home = (await realPathIfResolvable(params.home)) ?? path.resolve(params.home);

  return isInside({ folder: dir, target: home });
}
