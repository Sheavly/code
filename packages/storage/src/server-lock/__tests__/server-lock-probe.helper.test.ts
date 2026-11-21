import { lstat, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { probeServerLock } from '../server-lock-probe.helper.js';
import { useWorkers } from '../testing/server-lock-children.fake.js';
import { useLockPlace } from '../testing/server-lock-place.fake.js';

const { place, lockPath, acquire } = useLockPlace();
const workers = useWorkers();
const posix = describe.skipIf(process.platform === 'win32');

posix('probeServerLock', () => {
  it('is held while a server holds the lock, and leaves the socket as it was', async () => {
    const where = place();
    const result = await acquire({ ...where });

    expect(result.status).toBe('acquired');

    const target = await lockPath(where);
    const before = await lstat(target);

    expect(await probeServerLock({ ...where, platform: 'linux' })).toBe('held');
    expect((await lstat(target)).ino).toBe(before.ino);
  });

  it('is free when no lock socket exists, and creates nothing', async () => {
    const where = place();
    const before = await readdir(where.runtimeDir);

    expect(await probeServerLock({ ...where, platform: 'linux' })).toBe('free');
    expect(await readdir(where.runtimeDir)).toEqual(before);
  });

  it('is free for the stale socket a killed server leaves, and does not remove it', async () => {
    const where = place();

    await workers.leaveStaleSocket(where);

    const target = await lockPath(where);

    expect(await probeServerLock({ ...where, platform: 'linux' })).toBe('free');
    expect((await lstat(target)).isSocket()).toBe(true);
  });

  it('is free for a folder that does not exist', async () => {
    const where = place();

    expect(
      await probeServerLock({
        home: where.home,
        runtimeDir: path.join(where.runtimeDir, 'missing'),
        platform: 'linux',
      }),
    ).toBe('free');
  });

  it('is inconclusive when the connect fails for a reason that is neither refused nor missing', async () => {
    const where = place();
    const runtimeDir = path.join(where.runtimeDir, 'x'.repeat(200));

    await mkdir(runtimeDir);

    expect(await probeServerLock({ home: where.home, runtimeDir, platform: 'linux' })).toBe(
      'inconclusive',
    );
  });
});
