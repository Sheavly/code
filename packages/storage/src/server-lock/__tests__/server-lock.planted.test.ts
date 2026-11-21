import { execFile } from 'node:child_process';
import { lstat, mkdir, readlink, symlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, onTestFinished } from 'vitest';
import { useLockPlace } from '../testing/server-lock-place.fake.js';
import { useWorkers } from '../testing/server-lock-children.fake.js';

const run = promisify(execFile);
const { place, lockPath, acquire } = useLockPlace();
const workers = useWorkers();
const posix = describe.skipIf(process.platform === 'win32');

/** A server of this test's own, standing in for another program's live socket. */
async function listenAt(file: string): Promise<net.Server> {
  const server = net.createServer((socket) => {
    socket.destroy();
  });

  await new Promise<void>((resolve) => {
    server.listen(file, resolve);
  });
  onTestFinished(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  return server;
}

const planters: Record<string, (params: { target: string; folder: string }) => Promise<unknown>> = {
  'a regular file': ({ target }) => writeFile(target, 'not a socket'),
  'a directory': ({ target }) => mkdir(target),
  'a dangling symlink': ({ target, folder }) => symlink(path.join(folder, 'nowhere'), target),
  'a symlink to a live socket': async ({ target, folder }) => {
    await listenAt(path.join(folder, 'live.sock'));
    await symlink(path.join(folder, 'live.sock'), target);
  },
  'a fifo': ({ target }) => run('mkfifo', [target]),
};

posix('a name planted at the lock path', () => {
  it.each(Object.keys(planters))('is left untouched when it is %s', async (name) => {
    const where = place();
    const target = await lockPath(where);

    await planters[name]?.({ target, folder: where.runtimeDir });

    const before = await lstat(target);
    const link = before.isSymbolicLink() ? await readlink(target) : undefined;
    const result = await acquire(where);
    const after = await lstat(target);

    expect(result).toEqual({ status: 'unusable', path: target, reason: 'not-our-socket' });
    expect([after.ino, after.mode, after.size]).toEqual([before.ino, before.mode, before.size]);
    expect(after.isSymbolicLink() ? await readlink(target) : undefined).toBe(link);
  });
});

posix('a socket that cannot be probed', () => {
  it('is inconclusive, never taken for stale, and left in place', async () => {
    const where = place();
    const target = await lockPath(where);
    const child = workers.start(['frozen', target]);

    await workers.nextEvent(child);
    // A stopped process never accepts: once its backlog is full a connect gets no answer.
    child.kill('SIGSTOP');

    const crowd = Array.from({ length: 20 }, () => {
      const socket = net.connect(target);

      socket.on('error', () => undefined);

      return socket;
    });

    onTestFinished(() => {
      for (const socket of crowd) socket.destroy();
    });

    const result = await acquire({ ...where, probeTimeoutMs: 300 });

    expect(result).toEqual({ status: 'unusable', path: target, reason: 'probe-inconclusive' });
    expect((await lstat(target)).isSocket()).toBe(true);
  });
});
