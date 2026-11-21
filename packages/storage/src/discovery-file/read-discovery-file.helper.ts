import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import {
  DISCOVERY_FILE_NAME,
  DISCOVERY_MAX_BYTES,
} from '@sheavly/protocol/discovery/discovery.constants';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';
import { checkPrivateDirectory } from '../server-runtime/server-runtime.helper.js';
import type { DiscoveryPlace, ReadResult } from './discovery-file.types.js';
import { parseDiscoveryText, refuseOpenFile } from './discovery-file.utils.js';

/**
 * Reads `server.json` from `directory`, the mirror of `publishDiscoveryFile`: the folder must be
 * the private one of `uid` (the same check), the file is opened without following a link and
 * judged by the open handle (a regular file of `uid`, closed to others, at most
 * `DISCOVERY_MAX_BYTES`), so nothing can be swapped between the check and the read. Never throws
 * and never puts the file's text in a result: only `found` carries the token. A missing folder or
 * file is `none`. Where the system has no owners or modes (Windows) only the kind and size are
 * judged.
 */
export async function readDiscoveryFile(params: DiscoveryPlace): Promise<ReadResult> {
  try {
    return await readChecked(params);
  } catch (caughtError) {
    // The contract is a value, never a throw. The text is parsed where no error can quote it, so
    // what reaches here is a file system error, which names paths only.
    return { status: 'refused', reason: 'unreadable', cause: caughtError };
  }
}

async function readChecked(params: DiscoveryPlace): Promise<ReadResult> {
  const { directory, uid, platform = process.platform } = params;

  if (platform !== 'win32') {
    const check = await checkPrivateDirectory({ directory, uid });

    if (check.status === 'refused') {
      return check.detail === 'missing'
        ? { status: 'none' }
        : { status: 'refused', reason: 'folder', detail: check.detail };
    }
  }

  // O_NONBLOCK so a FIFO at the name is opened (and refused as not regular), not waited on.
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  const handle = await openOrOutcome({ file: path.join(directory, DISCOVERY_FILE_NAME), flags });

  if ('status' in handle) return handle;

  try {
    const stat = await handle.stat();
    const refusal = refuseOpenFile({
      stat: { isFile: stat.isFile(), uid: stat.uid, mode: stat.mode, size: stat.size },
      uid,
      platform,
    });

    if (refusal !== undefined) return { status: 'refused', ...refusal };

    // One byte more than allowed, to tell a file that grew since the check from one that fits.
    const buffer = Buffer.alloc(DISCOVERY_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);

    if (bytesRead > DISCOVERY_MAX_BYTES) return { status: 'refused', reason: 'too-large' };

    return parseDiscoveryText(buffer.toString('utf8', 0, bytesRead));
  } finally {
    await handle.close();
  }
}

async function openOrOutcome(params: { file: string; flags: number }) {
  try {
    return await open(params.file, params.flags);
  } catch (caughtError) {
    const code = errorCode(caughtError);

    if (code === 'ENOENT') return { status: 'none' } as const;

    // ELOOP (EMLINK on some systems): the name is a link, which `O_NOFOLLOW` refuses to open.
    if (code === 'ELOOP' || code === 'EMLINK') {
      return { status: 'refused', reason: 'link' } as const;
    }

    throw caughtError;
  }
}
