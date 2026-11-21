import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { afterEach } from 'vitest';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';
import { serverNameHash } from '../../server-runtime/server-runtime.helper.js';
import { serverEndpoint } from '../../server-runtime/server-runtime.utils.js';
import { useTempFolder } from '../../testing/temp-folder.fake.js';
import { acquireServerLock } from '../server-lock.helper.js';
import type { ServerLockResult } from '../server-lock.types.js';

/**
 * Test-only: a home and a private runtime folder in the test's own temp folder, and an `acquire`
 * that releases every lock it took when the test ends, so no socket outlives the test.
 */
export function useLockPlace(): {
  place: () => { home: string; runtimeDir: string };
  lockPath: (where: { home: string; runtimeDir: string }) => Promise<string>;
  acquire: (params: Parameters<typeof acquireServerLock>[0]) => Promise<ServerLockResult>;
  exists: (file: string) => Promise<boolean>;
} {
  const temp = useTempFolder('server-lock-');
  const taken: ServerLockResult[] = [];

  afterEach(async () => {
    for (const result of taken.splice(0)) {
      if (result.status === 'acquired') await result.release();
    }
  });

  return {
    place: () => ({ home: path.join(temp.path(), 'home'), runtimeDir: temp.path() }),
    lockPath: async (where) =>
      serverEndpoint({
        platform: 'linux',
        runtimeDir: where.runtimeDir,
        hash: await serverNameHash({ home: where.home }),
      }),
    acquire: async (params) => {
      const result = await acquireServerLock(params);

      taken.push(result);

      return result;
    },
    exists: async (file) => {
      try {
        await lstat(file);

        return true;
      } catch (caughtError) {
        if (errorCode(caughtError) === 'ENOENT') return false;

        throw caughtError;
      }
    },
  };
}
