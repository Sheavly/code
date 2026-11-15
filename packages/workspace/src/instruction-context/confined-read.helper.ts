import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { open, realpath, stat } from 'node:fs/promises';
import { isEnvName, isInside } from '../workspace/workspace.utils.js';
import { MAX_INSTRUCTION_FILE_BYTES } from './instruction-source.constants.js';

/**
 * Read-only, never through a final symlink, and without blocking, so a FIFO fails at once instead
 * of waiting for a writer. Windows has no `O_NOFOLLOW` or `O_NONBLOCK` (`undefined`, which adds
 * nothing there); the checks on the open handle are what hold on every platform.
 */
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/**
 * A file that is not there, a symlink loop that never leads to one, or one that cannot be read
 * without blocking (a FIFO): skipped, not fatal.
 */
function isSkippable(caughtError: unknown): boolean {
  const code = (caughtError as NodeJS.ErrnoException).code;

  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP' || code === 'EAGAIN';
}

/** The real path of `target`, or `target` as given when nothing is there. */
export async function realPathOrSelf(target: string): Promise<string> {
  try {
    return await realpath(target);
  } catch (caughtError) {
    if (isSkippable(caughtError)) return target;

    throw caughtError;
  }
}

/**
 * True when the open `handle` is the file the checked path still names, and one worth reading: a
 * regular file with a single name (a hard link inside the boundary could be a `.env` or a foreign
 * file under another name), within the size cap, and the same device and inode as the path.
 * Resolved against the handle, so a folder swapped for a link around the open cannot make the
 * check and the read look at different files.
 */
async function isTheCheckedFile(params: { handle: FileHandle; real: string }): Promise<boolean> {
  const { handle, real } = params;
  const opened = await handle.stat();

  if (!opened.isFile() || opened.nlink !== 1 || opened.size > MAX_INSTRUCTION_FILE_BYTES) {
    return false;
  }

  const named = await stat(real);

  return named.dev === opened.dev && named.ino === opened.ino;
}

/**
 * The text of `file`, or `undefined` when it is missing or may not be read. A path chosen by the
 * agent must not lead out of `boundary` (a real path) or to a `.env*` file, or it would put a
 * foreign file or a secret in the model's context. The checked real path is opened, and what is
 * read is the open handle, which is then verified (`isTheCheckedFile`): a regular file, one name,
 * under the size cap, the same file the path names. A path swapped before the open is refused by
 * that check; one swapped after it cannot change the handle. A folder swapped for a link and back
 * around the open can still redirect it to a file of the same inode only, which is the file.
 */
export async function readConfinedFile(params: {
  file: string;
  boundary: string;
  signal?: AbortSignal | undefined;
}): Promise<string | undefined> {
  const { file, boundary, signal } = params;

  try {
    const real = await realpath(file);

    if (!isInside({ folder: boundary, target: real }) || isEnvName(real)) return undefined;

    const handle = await open(real, OPEN_FLAGS);

    try {
      if (!(await isTheCheckedFile({ handle, real }))) return undefined;

      return await handle.readFile({ encoding: 'utf8', ...(signal && { signal }) });
    } finally {
      await handle.close();
    }
  } catch (caughtError) {
    if (isSkippable(caughtError)) return undefined;

    throw caughtError;
  }
}
