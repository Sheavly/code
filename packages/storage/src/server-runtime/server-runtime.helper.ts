import { chmod, lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { errorCode, errorMessage, isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { GROUP_AND_OTHERS, PRIVATE_FOLDER_MODE } from '../json-file/json-file.constants.js';
import {
  ALL_PERMISSION_BITS,
  RUNTIME_SUBFOLDER,
  XDG_RUNTIME_VARIABLE,
} from './server-runtime.constants.js';
import type { PrivateDirectoryCheck, ServerRuntimeDirectory } from './server-runtime.types.js';
import { hashResolvedHome } from './server-runtime.utils.js';

type Refused = Extract<PrivateDirectoryCheck, { status: 'refused' }>;

/**
 * Whether `directory` is a real folder (a symlink is refused, not followed) owned by `uid` that
 * nobody else can open: no group or world access. Never throws; the verdict says what is wrong
 * and which problem a caller should report. Looks only: it changes nothing. Where the system has
 * no owners or modes (Windows) do not call it.
 */
export async function checkPrivateDirectory(params: {
  directory: string;
  uid: number;
}): Promise<PrivateDirectoryCheck> {
  const { directory, uid } = params;

  try {
    const found = await lstat(directory);

    if (found.isSymbolicLink()) return refused({ detail: 'symlink' });

    if (!found.isDirectory()) return refused({ detail: 'not-directory' });

    if (found.uid !== uid) return refused({ detail: 'other-owner' });

    if ((found.mode & GROUP_AND_OTHERS) !== 0) return refused({ detail: 'too-open' });

    return { status: 'private' };
  } catch (caughtError) {
    return refused({
      detail: isMissingPath(caughtError) ? 'missing' : 'unreadable',
      cause: caughtError,
    });
  }
}

function refused(params: { detail: Refused['detail']; cause?: unknown }): Refused {
  const { detail, cause } = params;
  const problem =
    detail === 'missing' || detail === 'unreadable' ? 'dir-unwritable' : 'dir-not-ours';

  return cause === undefined
    ? { status: 'refused', problem, detail }
    : { status: 'refused', problem, detail, cause };
}

/**
 * The name of the server of `home`: 12 hex characters of the sha256 of its real path, so a home
 * reached through a symlink names the same server, and two homes never share one. A home that
 * does not exist yet is hashed by its absolute path. Rejects when the path cannot be resolved at
 * all (a NUL byte, a name too long); `serverRuntimeDirectory` handles that itself.
 */
export async function serverNameHash(params: { home: string }): Promise<string> {
  try {
    return hashResolvedHome(await realpath(params.home));
  } catch (caughtError) {
    if (!isMissingPath(caughtError)) throw caughtError;

    return hashResolvedHome(path.resolve(params.home));
  }
}

/**
 * The one folder where both the lock socket and the discovery file live. When
 * `$XDG_RUNTIME_DIR` names a private folder of this user it is
 * `$XDG_RUNTIME_DIR/sheavly/<hash>`, one folder per home (`<hash>` is `serverNameHash`, the name
 * of the lock socket), because `sheavly` is shared by every home on the machine and the discovery
 * file has a fixed name. Otherwise it is `home` itself, which is already per home. There is no
 * shared-folder fallback (`/tmp`): another user could plant names there. If either `sheavly` or
 * the hash folder cannot be made private, it falls back to home with a `warning`; an unusable home
 * is `unusable`. Creates both folders when missing and sets them to 0700 whatever the umask made
 * of them, and sets them to 0700 whenever they are ours with any other mode, a missing owner bit
 * included; a folder that is not its own is reported, never changed. A home folder this call made
 * is set to 0700 too, and one that already existed is never changed. The result is not checked for
 * the socket's path length: the lock refuses a path that is too long. On Windows there are no
 * modes or owners: it returns `home`, and `uid` is ignored.
 */
export async function serverRuntimeDirectory(params: {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  platform: NodeJS.Platform;
  uid: number;
}): Promise<ServerRuntimeDirectory> {
  const { env, home, platform, uid } = params;

  if (platform === 'win32') return { status: 'ready', directory: home, source: 'home' };

  const xdg = env[XDG_RUNTIME_VARIABLE];
  const fromXdg = xdg === undefined || xdg === '' ? undefined : await xdgFolder({ xdg, home, uid });

  if (fromXdg?.status === 'ready') return fromXdg.ready;

  const fromHome = await homeFolder({ home, uid });

  return fromXdg?.status === 'skipped' && fromHome.status === 'ready'
    ? { ...fromHome, warning: fromXdg.warning }
    : fromHome;
}

type XdgOutcome =
  { status: 'ready'; ready: ServerRuntimeDirectory } | { status: 'skipped'; warning: string };

async function xdgFolder(params: { xdg: string; home: string; uid: number }): Promise<XdgOutcome> {
  const { xdg, home, uid } = params;

  if (!path.isAbsolute(xdg)) {
    return skipped(`${XDG_RUNTIME_VARIABLE} is not an absolute path (${xdg})`);
  }

  const parent = await checkPrivateDirectory({ directory: xdg, uid });

  if (parent.status === 'refused') return skipped(describe({ directory: xdg, check: parent }));

  const shared = path.join(xdg, RUNTIME_SUBFOLDER);
  const sharedCheck = await ownFolder({ directory: shared, uid });

  if (sharedCheck.status === 'refused') {
    return skipped(describe({ directory: shared, check: sharedCheck }));
  }

  let hash: string;

  try {
    hash = await serverNameHash({ home });
  } catch (caughtError) {
    // A home that cannot be resolved (a NUL byte, a name too long) cannot name a folder either.
    return skipped(
      `${XDG_RUNTIME_VARIABLE} folder was not used (the home cannot be named: ${errorMessage(caughtError)}); using the Sheavly home folder`,
    );
  }

  const directory = path.join(shared, hash);
  const check = await ownFolder({ directory, uid });

  if (check.status === 'refused') return skipped(describe({ directory, check }));

  return { status: 'ready', ready: { status: 'ready', directory, source: 'xdg' } };
}

function skipped(warning: string): XdgOutcome {
  return { status: 'skipped', warning };
}

function describe(params: { directory: string; check: Refused }): string {
  const { directory, check } = params;
  const why = check.cause === undefined ? check.detail : errorMessage(check.cause);

  return `${XDG_RUNTIME_VARIABLE} folder ${directory} was not used (${why}); using the Sheavly home folder`;
}

/**
 * A folder this code names under the runtime folder (`sheavly`, or a home's hash folder in it):
 * made when missing, and, being ours by name, set to 0700 when it is ours with any other mode: a
 * folder made under a strict umask lacks owner bits, and one open to others is not private.
 * A symlink, a non-folder or another user's folder is reported, never changed.
 */
async function ownFolder(params: {
  directory: string;
  uid: number;
}): Promise<PrivateDirectoryCheck> {
  const { directory, uid } = params;

  try {
    await mkdir(directory, { mode: PRIVATE_FOLDER_MODE });
  } catch (caughtError) {
    if (errorCode(caughtError) !== 'EEXIST') {
      return refused({ detail: 'unreadable', cause: caughtError });
    }
  }

  const check = await checkPrivateDirectory({ directory, uid });

  if (check.status === 'refused' && check.detail !== 'too-open') return check;

  try {
    // Checked as ours above, so the mode is ours to set; the mkdir mode alone is cut by the umask.
    if (((await lstat(directory)).mode & ALL_PERMISSION_BITS) !== PRIVATE_FOLDER_MODE) {
      await chmod(directory, PRIVATE_FOLDER_MODE);
    }
  } catch (caughtError) {
    return refused({ detail: 'unreadable', cause: caughtError });
  }

  return checkPrivateDirectory({ directory, uid });
}

/**
 * The Sheavly home as the runtime folder. A home reached through a symlink is used by its real
 * path (the user chose it); a home that already exists and is open to others is not ours to
 * tighten.
 */
async function homeFolder(params: { home: string; uid: number }): Promise<ServerRuntimeDirectory> {
  const { home, uid } = params;

  try {
    const created = await mkdir(home, { recursive: true, mode: PRIVATE_FOLDER_MODE });

    // Only a home this call made is set to 0700 (the umask may have cut it); one that already
    // existed is the user's and is checked, never changed.
    if (created !== undefined) await chmod(home, PRIVATE_FOLDER_MODE);

    const directory = await realpath(home);
    const check = await checkPrivateDirectory({ directory, uid });

    if (check.status === 'private') return { status: 'ready', directory, source: 'home' };

    return { status: 'unusable', directory, problem: check.problem, detail: check.detail };
  } catch (caughtError) {
    return {
      status: 'unusable',
      directory: home,
      problem: 'dir-unwritable',
      detail: 'unreadable',
      cause: caughtError,
    };
  }
}
