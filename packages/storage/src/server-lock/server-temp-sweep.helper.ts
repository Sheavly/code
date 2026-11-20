import { lstat, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';
import { isProcessRunning } from '../server-runtime/server-runtime.utils.js';
import { isOurSocket, temporaryNamePid } from './server-lock.utils.js';

/**
 * Removes the temporary sockets of the lock socket `socketPath` that a process killed between
 * `listen` and `unlink` left behind. Only a socket of `uid` named for a pid that no longer runs is
 * removed; a link, a regular file or a folder with such a name is left alone, and a temporary
 * name of a running process (a publish in flight, maybe this one's) is kept.
 */
export async function sweepAbandonedSockets(params: {
  socketPath: string;
  uid: number;
}): Promise<void> {
  const { socketPath, uid } = params;
  const directory = path.dirname(socketPath);
  const socketName = path.basename(socketPath);

  for (const name of await readdir(directory)) {
    const pid = temporaryNamePid({ name, socketName });

    if (pid !== undefined && !isProcessRunning(pid)) {
      await removeIfOurSocket({ file: path.join(directory, name), uid });
    }
  }
}

async function removeIfOurSocket(params: { file: string; uid: number }): Promise<void> {
  try {
    // `lstat`, never a followed link: only a socket of ours is ever unlinked.
    const found = await lstat(params.file);

    if (isOurSocket({ found, uid: params.uid })) await unlink(params.file);
  } catch (caughtError) {
    // Another contender swept it first.
    if (errorCode(caughtError) !== 'ENOENT') throw caughtError;
  }
}
