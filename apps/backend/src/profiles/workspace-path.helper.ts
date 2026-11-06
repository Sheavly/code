import { realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SetupError } from '../errors/setup.errors.js';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';

/** Whether `inner` is `outer` or inside it, by path alone. */
function isWithin(params: { outer: string; inner: string }): boolean {
  const relative = path.relative(params.outer, params.inner);

  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * Why a folder named in a request is no place for an agent to work, or `undefined` when it is.
 * Pure: it looks at the paths. The agent can read and write everything inside its workspace, so
 * the folder must not be the top of a file system or the user's home (everything they own), nor
 * hold or sit inside the user's `sheavly` folder (where their keys are, and which is only safe
 * from the file tools while no workspace reaches it). `real` is the folder with symlinks followed.
 */
export function unsafeWorkspaceReason(params: {
  real: string;
  home: string;
  sheavlyHome: string;
}): string | undefined {
  const { real, home, sheavlyHome } = params;

  if (path.dirname(real) === real) return 'it is the root of a file system';

  if (real === path.resolve(home)) {
    return 'it is the home folder, which holds everything the user owns';
  }

  if (isWithin({ outer: real, inner: path.resolve(sheavlyHome) })) {
    return 'it holds the folder where profiles and keys are kept';
  }

  if (isWithin({ outer: path.resolve(sheavlyHome), inner: real })) {
    return 'it is inside the folder where profiles and keys are kept';
  }

  return undefined;
}

/**
 * The real path of the folder a request names as a conversation's workspace. Throws a `SetupError`
 * (`invalid`) saying what is wrong, and never quotes more than the path the caller sent: the
 * path is not absolute, there is no such folder, it is a file, or `unsafeWorkspaceReason`.
 */
export async function resolveWorkspace(params: {
  requested: string;
  sheavlyHome: string;
}): Promise<string> {
  const { requested, sheavlyHome } = params;
  const refuse = (reason: string) =>
    new SetupError({
      reason: 'invalid',
      message: `The workspace ${requested} cannot be used: ${reason}`,
    });

  if (!path.isAbsolute(requested)) throw refuse('give an absolute path');

  let real: string;

  try {
    real = await realpath(requested);

    if (!(await stat(real)).isDirectory()) throw refuse('it is not a folder');
  } catch (caughtError) {
    // A path that is not there is the caller's to fix; anything else is not ours to hide.
    if (caughtError instanceof SetupError) throw caughtError;
    if (!isMissingPath(caughtError)) throw caughtError;
    throw refuse('there is no such folder');
  }

  const reason = unsafeWorkspaceReason({
    real,
    home: os.homedir(),
    sheavlyHome: await realOf(sheavlyHome),
  });

  if (reason) throw refuse(reason);

  return real;
}

/** `folder` with symlinks followed, or as given when it does not exist yet (a first run). */
async function realOf(folder: string): Promise<string> {
  try {
    return await realpath(folder);
  } catch (caughtError) {
    if (!isMissingPath(caughtError)) throw caughtError;

    return path.resolve(folder);
  }
}
