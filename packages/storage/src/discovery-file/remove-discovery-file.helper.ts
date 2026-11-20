import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { DISCOVERY_FILE_NAME } from '@sheavly/protocol/discovery/discovery.constants';
import type { DiscoveryFile } from '@sheavly/protocol/discovery/discovery.types';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import type { DiscoveryPlace, RemoveResult } from './discovery-file.types.js';
import { sweepAbandonedTemps } from './discovery-temp-sweep.helper.js';
import { readDiscoveryFile } from './read-discovery-file.helper.js';

/**
 * Removes `server.json` from `directory` only if it is the file of `instanceId`, read the safe
 * way: a successor's file, a file that cannot be read and a missing file are all left alone.
 * Temp files that a crashed publish left behind are swept too, whatever happened to the file.
 * Never throws. Call it before releasing the lock, so no successor can have written its own yet.
 *
 * The read and the unlink are two steps, not one atomic one, so a successor that publishes between
 * them loses its file and the instance check does not close that window. It is reachable only
 * after a crash takeover, because a live server removes its file before it releases the lock.
 */
export async function removeDiscoveryFile(
  params: DiscoveryPlace & { instanceId: DiscoveryFile['instanceId'] },
): Promise<RemoveResult> {
  const result = await removeIfOurs(params);

  try {
    await sweepAbandonedTemps(params.directory);
  } catch (caughtError) {
    // A folder that is gone has no leftovers; any other failure is reported unless one is already.
    if (isMissingPath(caughtError)) return result;

    return result.status === 'failed' ? result : { status: 'failed', cause: caughtError };
  }

  return result;
}

async function removeIfOurs(
  params: DiscoveryPlace & { instanceId: DiscoveryFile['instanceId'] },
): Promise<RemoveResult> {
  const { directory, instanceId } = params;
  const found = await readDiscoveryFile(params);

  if (found.status === 'none') return { status: 'left', reason: 'absent' };

  if (found.status !== 'found') return { status: 'left', reason: 'unreadable' };

  if (found.value.instanceId !== instanceId) return { status: 'left', reason: 'not-ours' };

  try {
    await unlink(path.join(directory, DISCOVERY_FILE_NAME));

    return { status: 'removed' };
  } catch (caughtError) {
    // The contract is a value, never a throw. A file already gone is what was asked for.
    return isMissingPath(caughtError)
      ? { status: 'left', reason: 'absent' }
      : { status: 'failed', cause: caughtError };
  }
}
