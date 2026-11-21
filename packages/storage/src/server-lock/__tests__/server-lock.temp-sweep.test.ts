import { lstat, mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { useWorkers } from '../testing/server-lock-children.fake.js';
import { useLockPlace } from '../testing/server-lock-place.fake.js';

const DEAD_TEMPORARIES = 20;
const posix = describe.skipIf(process.platform === 'win32');
const workers = useWorkers();
const { place, lockPath, acquire, exists } = useLockPlace();

/** A process that listens under temporary names of the lock socket and then is killed or kept. */
async function holdTemporaries(params: { socket: string; count: number; kill: boolean }) {
  const child = workers.start(['temporaries', params.socket, String(params.count)]);
  const { names = [] } = await workers.nextEvent(child);

  if (params.kill) await workers.kill(child);

  return { names, pid: child.pid ?? 0 };
}

posix('temporary sockets left by a server killed between listen and unlink', () => {
  it('are all swept by the next acquire, which leaves the folder with only the lock socket', async () => {
    const where = place();
    const socket = await lockPath(where);
    const { names } = await holdTemporaries({
      socket,
      count: DEAD_TEMPORARIES,
      kill: true,
    });

    expect(names).toHaveLength(DEAD_TEMPORARIES);
    expect(await readdir(where.runtimeDir)).toHaveLength(DEAD_TEMPORARIES);

    const result = await acquire(where);

    expect(result).toMatchObject({ status: 'acquired', path: socket });
    expect(await readdir(where.runtimeDir)).toEqual([path.basename(socket)]);

    if (result.status === 'acquired') await result.release();

    expect(await readdir(where.runtimeDir)).toEqual([]);
  }, 30_000);

  it('are swept also when the lock socket itself is a stale one that gets replaced', async () => {
    const where = place();
    const socket = await lockPath(where);

    await workers.leaveStaleSocket(where);
    await holdTemporaries({ socket, count: 3, kill: true });

    const result = await acquire(where);

    expect(result.status).toBe('acquired');
    expect(await readdir(where.runtimeDir)).toEqual([path.basename(socket)]);
  }, 30_000);

  it('are kept while the process that made them runs', async () => {
    const where = place();
    const socket = await lockPath(where);
    const { names } = await holdTemporaries({ socket, count: 1, kill: false });
    const result = await acquire(where);

    expect(result.status).toBe('acquired');
    expect((await lstat(names[0] ?? '')).isSocket()).toBe(true);
  }, 30_000);

  it('are left alone when they are a link, a regular file or a folder named like one', async () => {
    const where = place();
    const socket = await lockPath(where);
    const victim = path.join(where.runtimeDir, 'victim.txt');
    const { pid } = await holdTemporaries({ socket, count: 0, kill: true });
    const named = (suffix: string): string => `${socket}.${String(pid)}.${suffix}`;

    await writeFile(victim, 'kept');
    await symlink(victim, named('aaaaaa'));
    await writeFile(named('bbbbbb'), 'a regular file');
    await mkdir(named('cccccc'));
    await symlink(path.join(where.runtimeDir, 'nowhere'), named('dddddd'));

    const result = await acquire(where);

    expect(result.status).toBe('acquired');
    expect((await lstat(named('aaaaaa'))).isSymbolicLink()).toBe(true);
    expect((await lstat(named('bbbbbb'))).isFile()).toBe(true);
    expect((await lstat(named('cccccc'))).isDirectory()).toBe(true);
    expect((await lstat(named('dddddd'))).isSymbolicLink()).toBe(true);
    expect(await exists(victim)).toBe(true);
  }, 30_000);

  it('are not confused with files whose names only start like one', async () => {
    const where = place();
    const socket = await lockPath(where);
    const others = [`${socket}.1.zzzzzz`, `${socket}.x.aaaaaa`, `${socket}.12.aaaaaaa`];

    for (const other of others) await writeFile(other, 'not a temporary name');

    expect((await acquire(where)).status).toBe('acquired');

    for (const other of others) expect(await exists(other)).toBe(true);
  });
});
