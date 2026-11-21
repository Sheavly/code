import { randomUUID } from 'node:crypto';
import { lstat, open, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import {
  DISCOVERY_FILE_NAME,
  DISCOVERY_MAX_BYTES,
} from '@sheavly/protocol/discovery/discovery.constants';
import type { DiscoveryFile } from '@sheavly/protocol/discovery/discovery.types';
import { discoveryFileSchema } from '@sheavly/protocol/discovery/discovery.validator';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { PRIVATE_FILE_MODE } from '../json-file/json-file.constants.js';
import { replaceFile } from '../json-file/json-file.helper.js';
import { checkPrivateDirectory } from '../server-runtime/server-runtime.helper.js';
import type { DiscoveryPlace, PublishResult } from './discovery-file.types.js';
import { discoveryTempName } from './discovery-file.utils.js';
import { sweepAbandonedTemps } from './discovery-temp-sweep.helper.js';

/**
 * Writes `value` as `server.json` in `directory`, which must be the private runtime folder of
 * `uid` (`serverRuntimeDirectory`). The file is whole or absent: it is written to a temp file made
 * with `O_EXCL` (so a planted link at that name fails, never followed), flushed, set to 0600
 * whatever the umask says, and renamed over the final name. Never throws: a folder that is not
 * private, a target that is not a regular file or a value that is not a discovery file is
 * `refused` with nothing written; any other error is `failed` and leaves no temp file. Neither
 * the token nor the value is in any message. `newNonce` makes the temp name unique and exists so a
 * test can plant something at it. `maxBytes` is the reader's cap and is lowered only by a test:
 * the schema already keeps a valid value within it.
 *
 * Only a folder at the final name is refused (`target-is-folder`). A link, FIFO or socket there is
 * replaced by the rename, which never follows a link, so a planted one cannot keep the server
 * undiscoverable. A file the reader would refuse as too large is `refused` (`too-large`) before
 * anything is written.
 */
export async function publishDiscoveryFile(
  params: DiscoveryPlace & { value: DiscoveryFile; newNonce?: () => string; maxBytes?: number },
): Promise<PublishResult> {
  const {
    directory,
    uid,
    platform = process.platform,
    newNonce = randomUUID,
    maxBytes = DISCOVERY_MAX_BYTES,
  } = params;
  const parsed = discoveryFileSchema.safeParse(params.value);

  if (!parsed.success) return { status: 'refused', reason: 'invalid-value' };

  const text = `${JSON.stringify(parsed.data)}\n`;

  if (Buffer.byteLength(text) > maxBytes) return { status: 'refused', reason: 'too-large' };

  try {
    if (platform !== 'win32') {
      const check = await checkPrivateDirectory({ directory, uid });

      if (check.status === 'refused') {
        return { status: 'refused', reason: 'folder', detail: check.detail };
      }
    }

    const file = path.join(directory, DISCOVERY_FILE_NAME);

    if (await isFolder(file)) return { status: 'refused', reason: 'target-is-folder' };

    await sweepAbandonedTemps(directory);

    const temp = path.join(directory, discoveryTempName({ pid: process.pid, nonce: newNonce() }));

    await writeThenReplace({ temp, file, text });

    return { status: 'published', path: file };
  } catch (caughtError) {
    // The contract is a value, never a throw: the error rides in `cause` for the caller to log.
    return { status: 'failed', cause: caughtError };
  }
}

/** `lstat`, so a link is judged as itself: a rename replaces it and never touches its target. */
async function isFolder(file: string): Promise<boolean> {
  try {
    return (await lstat(file)).isDirectory();
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return false;

    throw caughtError;
  }
}

async function writeThenReplace(params: {
  temp: string;
  file: string;
  text: string;
}): Promise<void> {
  const { temp, file, text } = params;
  // Outside the `try`: if this fails the name was taken by something that is not ours to remove.
  let handle: FileHandle | undefined = await open(temp, 'wx', PRIVATE_FILE_MODE);

  try {
    await handle.writeFile(text);
    await handle.sync();
    // The umask can strip or widen the mode `open` was given; the handle's own mode is final.
    await handle.chmod(PRIVATE_FILE_MODE);
    await handle.close();
    handle = undefined;
    await replaceFile({ from: temp, to: file });
  } catch (caughtError) {
    await discardTemp({ handle, temp, writeError: caughtError });
    throw caughtError;
  }
}

/** Closes and removes the temp file of a write that failed; a failure of that is reported too. */
async function discardTemp(params: {
  handle: FileHandle | undefined;
  temp: string;
  writeError: unknown;
}): Promise<void> {
  const { handle, temp, writeError } = params;

  try {
    await handle?.close();
    await rm(temp, { force: true });
  } catch (caughtError) {
    throw new AggregateError([writeError, caughtError], 'The write and its cleanup failed', {
      cause: caughtError,
    });
  }
}
