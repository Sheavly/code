import { chmod, mkdir, readdir, stat, symlink } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { acquireServerLock } from '../server-lock.helper.js';
import { useLockPlace } from '../testing/server-lock-place.fake.js';

const { place, lockPath, acquire, exists } = useLockPlace();
const posix = it.skipIf(process.platform === 'win32');

describe('acquireServerLock', () => {
  posix('acquires, reports a second taker as held, and release removes the socket', async () => {
    const where = place();
    const first = await acquire(where);
    const second = await acquire(where);
    const expected = await lockPath(where);

    expect(first).toMatchObject({ status: 'acquired', path: expected });
    expect(second).toEqual({ status: 'held', path: expected });
    expect((await stat(expected)).isSocket()).toBe(true);

    if (first.status === 'acquired') await first.release();

    expect(await exists(expected)).toBe(false);
  });

  posix('release twice does nothing the second time, and the lock can be taken again', async () => {
    const where = place();
    const first = await acquire(where);

    if (first.status !== 'acquired') throw new Error('expected the lock');

    const close = vi.spyOn(net.Server.prototype, 'close');

    try {
      await Promise.all([first.release(), first.release()]);
      await first.release();

      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      close.mockRestore();
    }

    const again = await acquire(where);

    expect(again.status).toBe('acquired');

    // The first release must not remove the socket the new holder made.
    await first.release();

    expect(await exists(await lockPath(where))).toBe(true);
  });

  posix('names one lock for a home reached through a symlink', async () => {
    const where = place();
    const link = path.join(where.runtimeDir, 'link');

    await mkdir(where.home);
    await symlink(where.home, link);
    await acquire(where);

    expect(await acquire({ home: link, runtimeDir: where.runtimeDir })).toMatchObject({
      status: 'held',
    });
  });

  posix('leaks no descriptors over 1000 probe connections', async () => {
    const where = place();
    const descriptors = async () => (await readdir('/proc/self/fd')).length;

    await acquire(where);

    const before = await descriptors();

    for (let index = 0; index < 1000; index += 1) {
      expect((await acquireServerLock(where)).status).toBe('held');
    }

    expect(await descriptors()).toBeLessThanOrEqual(before + 2);
  });

  posix('is unusable, never a throw, when its folder cannot be used', async () => {
    const where = place();
    const sealed = path.join(where.runtimeDir, 'sealed');
    const open = path.join(where.runtimeDir, 'open');
    const target = path.join(where.runtimeDir, 'target');

    await mkdir(sealed, { mode: 0o500 });
    await chmod(sealed, 0o500);
    await mkdir(open, { mode: 0o755 });
    await chmod(open, 0o755);
    await mkdir(target, { mode: 0o700 });
    await symlink(target, path.join(where.runtimeDir, 'link'));

    const results = await Promise.all([
      acquire({ home: where.home, runtimeDir: sealed }),
      acquire({ home: where.home, runtimeDir: open }),
      acquire({ home: where.home, runtimeDir: path.join(where.runtimeDir, 'link') }),
      acquire({ home: where.home, runtimeDir: path.join(where.runtimeDir, 'missing') }),
    ]);

    // Run as root, a sealed folder is still writable: nothing to prove there.
    const reasons = results.map((result) =>
      result.status === 'unusable' ? result.reason : result.status,
    );

    expect(reasons.slice(1)).toEqual(['dir-not-ours', 'dir-not-ours', 'dir-unwritable']);
    expect(process.getuid?.() === 0 ? 'dir-unwritable' : reasons[0]).toBe('dir-unwritable');
  });

  posix('refuses a path that is too long before touching the file system', async () => {
    const where = place();
    const runtimeDir = path.join(where.runtimeDir, 'x'.repeat(120));
    const result = await acquire({ home: where.home, runtimeDir });

    expect(result).toEqual({ status: 'unusable', reason: 'path-too-long' });
    expect(await exists(runtimeDir)).toBe(false);
    expect(await exists(where.home)).toBe(false);
  });

  posix('turns an unexpected error into an unusable result with the cause', async () => {
    const result = await acquire({ home: 'bad\0home', runtimeDir: place().runtimeDir });

    expect(result).toMatchObject({ status: 'unusable', reason: 'unexpected' });
    expect(result.status === 'unusable' ? result.cause : undefined).toBeInstanceOf(Error);
  });

  posix('leaves a live server of this process listening while it answers held', async () => {
    const where = place();

    const target = await lockPath(where);

    await acquire(where);

    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.connect(target);

      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        resolve(false);
      });
    });

    expect(connected).toBe(true);
  });
});
