import type * as FsPromises from 'node:fs/promises';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import type * as GuardHelper from '../server-guard.helper.js';
import { useWorkers } from '../testing/server-lock-children.fake.js';
import { connectOutcome } from '../testing/server-lock-connect.fake.js';
import { useLockPlace } from '../testing/server-lock-place.fake.js';

const failing = vi.hoisted(() => ({
  lstatOfTemporaryName: false,
  guardDrop: false,
  /** The code the next `link` fails with, or none. */
  linkCode: undefined as string | undefined,
  /** The next `chmod` of a temporary name fails. */
  chmodOfTemporaryName: false,
  /** The next `unlink` of a temporary name fails once. */
  unlinkOfTemporaryName: false,
  /** Another contender takes the guard over just before the holder's next check of it. */
  stealGuardBeforeCheck: false,
}));

/** A temporary name is the lock path with `.<pid>.<6 hex digits>` after it. */
const TEMPORARY_NAME = /\.sock\.\d+\.[0-9a-f]{6}$/;
const injected = (code: string): Error => Object.assign(new Error('injected failure'), { code });

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();

  return {
    ...actual,
    lstat: async (file: Parameters<typeof actual.lstat>[0]) => {
      if (failing.lstatOfTemporaryName && TEMPORARY_NAME.test(String(file))) {
        throw injected('EIO');
      }

      return actual.lstat(file);
    },
    chmod: async (
      file: Parameters<typeof actual.chmod>[0],
      mode: Parameters<typeof actual.chmod>[1],
    ) => {
      if (failing.chmodOfTemporaryName && TEMPORARY_NAME.test(String(file))) {
        throw injected('EIO');
      }

      return actual.chmod(file, mode);
    },
    link: async (existing: Parameters<typeof actual.link>[0], target: string) => {
      if (failing.linkCode !== undefined) throw injected(failing.linkCode);

      return actual.link(existing, target);
    },
    unlink: async (file: Parameters<typeof actual.unlink>[0]) => {
      if (failing.unlinkOfTemporaryName && TEMPORARY_NAME.test(String(file))) {
        failing.unlinkOfTemporaryName = false;

        throw injected('EIO');
      }

      return actual.unlink(file);
    },
  };
});
vi.mock('../server-guard.helper.js', async (importOriginal) => {
  const actual = await importOriginal<typeof GuardHelper>();

  return {
    ...actual,
    holdsGuard: async (guard: Parameters<typeof actual.holdsGuard>[0]) => {
      if (failing.stealGuardBeforeCheck) {
        failing.stealGuardBeforeCheck = false;
        await writeFile(guard.path, 'taken over by another contender');
      }

      return actual.holdsGuard(guard);
    },
    dropGuard: async (guard: Parameters<typeof actual.dropGuard>[0]) => {
      if (failing.guardDrop) throw Object.assign(new Error('injected failure'), { code: 'EIO' });

      await actual.dropGuard(guard);
    },
  };
});

const { place, lockPath, acquire } = useLockPlace();
const workers = useWorkers();
const posix = describe.skipIf(process.platform === 'win32');

/** The servers this process still has open: an undocumented but stable Node call, used to count. */
const activeHandles = (process as unknown as { _getActiveHandles: () => unknown[] })
  ._getActiveHandles;

const serversListening = (): number =>
  activeHandles.call(process).filter((handle) => handle instanceof net.Server).length;

const connects = async (file: string): Promise<boolean> =>
  (await connectOutcome(file)) === 'connected';

posix('a step that fails after the server is listening', () => {
  it('closes the server and answers, when the look at the published socket fails', async () => {
    const where = place();
    const before = serversListening();

    failing.lstatOfTemporaryName = true;

    try {
      const result = await acquire(where);

      expect(result).toMatchObject({ status: 'unusable', reason: 'unexpected' });
    } finally {
      failing.lstatOfTemporaryName = false;
    }

    await vi.waitFor(() => {
      expect(serversListening()).toBe(before);
    });
    expect(await connects(await lockPath(where))).toBe(false);
    // Nothing holds the lock: the next start gets it.
    expect((await acquire(where)).status).toBe('acquired');
  });

  it('closes the server and leaves nothing when the socket cannot be made private', async () => {
    const where = place();
    const before = serversListening();

    failing.chmodOfTemporaryName = true;

    try {
      expect(await acquire(where)).toMatchObject({ status: 'unusable', reason: 'unexpected' });
    } finally {
      failing.chmodOfTemporaryName = false;
    }

    expect(await readdir(where.runtimeDir)).toEqual([]);
    await vi.waitFor(() => {
      expect(serversListening()).toBe(before);
    });
    expect(await connects(await lockPath(where))).toBe(false);
  });

  it('takes the lock name down again when removing the temporary name fails after the link', async () => {
    const where = place();
    const target = await lockPath(where);
    const before = serversListening();

    failing.unlinkOfTemporaryName = true;

    const result = await acquire(where);

    expect(result).toMatchObject({ status: 'unusable', reason: 'unexpected' });
    // Not a dead socket that costs the next start the grace period.
    expect(await readdir(where.runtimeDir)).toEqual([]);

    await vi.waitFor(() => {
      expect(serversListening()).toBe(before);
    });
    expect(await connects(target)).toBe(false);
  });

  it.each(['EPERM', 'EOPNOTSUPP', 'ENOTSUP', 'EXDEV', 'EMLINK'])(
    'says the folder does not support links when the link fails with %s, and leaves nothing',
    async (code) => {
      const where = place();
      const before = serversListening();

      failing.linkCode = code;

      try {
        expect(await acquire(where)).toMatchObject({
          status: 'unusable',
          reason: 'link-unsupported',
        });
      } finally {
        failing.linkCode = undefined;
      }

      expect(await readdir(where.runtimeDir)).toEqual([]);
      await vi.waitFor(() => {
        expect(serversListening()).toBe(before);
      });
    },
  );

  it.each([
    ['EACCES', 'dir-unwritable'],
    ['EROFS', 'dir-unwritable'],
    ['EIO', 'unexpected'],
  ])('still reports a link that fails with %s as %s', async (code, reason) => {
    const where = place();

    failing.linkCode = code;

    try {
      expect(await acquire(where)).toMatchObject({ status: 'unusable', reason });
    } finally {
      failing.linkCode = undefined;
    }

    expect(await readdir(where.runtimeDir)).toEqual([]);
  });

  it('does not remove the stale socket when its guard was taken over before the last check', async () => {
    const where = place();
    const target = await lockPath(where);

    await workers.leaveStaleSocket(where);

    const staleIno = (await lstat(target)).ino;

    failing.stealGuardBeforeCheck = true;

    const result = await acquire({ ...where, guardTimeoutMs: 40 });

    expect(result).toEqual({ status: 'unusable', path: target, reason: 'retries-exhausted' });
    expect((await lstat(target)).ino).toBe(staleIno);
    // The new owner's guard is not dropped by the holder it was taken from.
    expect(await readFile(`${target}.guard`, 'utf8')).toBe('taken over by another contender');
  }, 30_000);

  it('keeps the lock it won, with its server, when dropping the guard fails', async () => {
    const where = place();
    const target = await lockPath(where);
    const before = serversListening();

    await workers.leaveStaleSocket(where);
    failing.guardDrop = true;

    const result = await acquire(where);

    failing.guardDrop = false;

    expect(result).toMatchObject({ status: 'acquired', path: target });
    expect(serversListening()).toBe(before + 1);
    expect(await connects(target)).toBe(true);

    if (result.status === 'acquired') await result.release();

    // The handle is gone from the list a moment after `close` is called, not at once.
    await vi.waitFor(() => {
      expect(serversListening()).toBe(before);
    });
  }, 30_000);
});
