import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';

/**
 * The bytes and the number of regular `.log` files already in `folder`; none when it does not
 * exist. A file that vanishes between the listing and its size is simply not counted, and a link
 * or folder named like a log is ignored rather than followed. Files are measured one at a time, so
 * a folder with many entries never opens many at once.
 */
export async function measureLogs(folder: string): Promise<{ bytes: number; logs: number }> {
  let entries;

  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return { bytes: 0, logs: 0 };
    throw caughtError;
  }

  let bytes = 0;
  let logs = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.log')) continue;

    try {
      bytes += (await stat(path.join(folder, entry.name))).size;
      logs += 1;
    } catch (caughtError) {
      if (!isMissingPath(caughtError)) throw caughtError;
    }
  }

  return { bytes, logs };
}
