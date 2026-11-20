import { readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';
import { isProcessRunning } from '../server-runtime/server-runtime.utils.js';
import { discoveryTempPid } from './discovery-file.utils.js';

/**
 * Removes the temp files that a publish of a process that no longer runs left behind: they are
 * 0600 files holding a token. One of a running process (a publish in flight) is not touched.
 */
export async function sweepAbandonedTemps(directory: string): Promise<void> {
  for (const name of await readdir(directory)) {
    const pid = discoveryTempPid(name);

    if (pid !== undefined && !isProcessRunning(pid)) {
      await removeLeftover(path.join(directory, name));
    }
  }
}

async function removeLeftover(leftover: string): Promise<void> {
  try {
    await unlink(leftover);
  } catch (caughtError) {
    // Gone already, or not a file (something else's folder at that name): not ours to clear.
    if (!['ENOENT', 'EISDIR', 'EPERM'].includes(errorCode(caughtError) ?? '')) throw caughtError;
  }
}
