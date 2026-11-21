import { spawn, spawnSync } from 'node:child_process';
import { lstat, unlink } from 'node:fs/promises';
import { describe, expect, it, onTestFinished } from 'vitest';
import { useWorkers } from '../testing/server-lock-children.fake.js';
import { connectOutcome as connects } from '../testing/server-lock-connect.fake.js';
import { useLockPlace } from '../testing/server-lock-place.fake.js';

const lock = useLockPlace();
const { place, lockPath, acquire, exists } = lock;
const workers = useWorkers();
const posix = describe.skipIf(process.platform === 'win32');
const hasPython3 = spawnSync('python3', ['--version']).error === undefined;

/** A program that binds a socket at `file`, and listens on it only `listenAfterMs` later. */
async function bindThenListen(params: { file: string; listenAfterMs: number }): Promise<void> {
  const script = [
    'import socket, sys, time',
    's = socket.socket(socket.AF_UNIX)',
    's.bind(sys.argv[1])',
    'print("bound", flush=True)',
    'time.sleep(float(sys.argv[2]) / 1000)',
    's.listen(5)',
    'time.sleep(60)',
  ].join('\n');
  const child = spawn('python3', ['-c', script, params.file, String(params.listenAfterMs)], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  onTestFinished(() => {
    child.kill('SIGKILL');
  });
  await new Promise<void>((resolve) => {
    child.stdout.once('data', () => {
      resolve();
    });
  });
}

posix('releasing a lock whose socket was replaced by a successor', () => {
  it('leaves the successor serving: a third taker is told it is held', async () => {
    const where = place();
    const target = await lockPath(where);
    const first = await acquire(where);

    if (first.status !== 'acquired') throw new Error('expected the lock');

    // Something removes the first server's socket file from outside; the successor takes the name.
    await unlink(target);

    const second = await acquire(where);

    expect(second.status).toBe('acquired');

    await first.release();

    expect(await exists(target)).toBe(true);
    expect(await connects(target)).toBe('connected');
    expect(await acquire(where)).toEqual({ status: 'held', path: target });
  });

  it('does the same when the first holder is another process', async () => {
    const where = place();
    const target = await lockPath(where);
    const child = workers.start(['racer']);

    await workers.nextEvent(child);

    const answer = workers.nextEvent(child);

    child.send({ ...where, startAt: 0 });
    expect((await answer).status).toBe('acquired');
    await unlink(target);

    expect((await acquire(where)).status).toBe('acquired');

    const released = workers.nextEvent(child);

    child.send({ release: true });
    await released;

    expect(await connects(target)).toBe('connected');
    expect(await acquire(where)).toEqual({ status: 'held', path: target });
  }, 30_000);
});

posix('a socket made by a program that binds before it listens', () => {
  // Skipped, not failed, on a machine without python3: it is the only way to bind without listening.
  it.skipIf(!hasPython3)('is left alone while that program is between the two calls', async () => {
    const where = place();
    const target = await lockPath(where);

    await bindThenListen({ file: target, listenAfterMs: 100 });

    const before = await lstat(target);
    const result = await acquire(where);
    const after = await lstat(target);

    expect(result).toEqual({ status: 'held', path: target });
    expect(after.ino).toBe(before.ino);
  });
});

posix('the lock path while another process takes and releases the lock', () => {
  it('never names a socket that refuses connections, in 200 rounds', async () => {
    const where = place();
    const target = await lockPath(where);
    const poller = workers.start(['poll', target]);

    await workers.nextEvent(poller);

    const cycler = workers.start(['cycle', where.home, where.runtimeDir, '200']);
    const cycled = await workers.nextEvent(cycler);
    const polled = workers.nextEvent(poller);

    poller.send('stop');

    const counts = await polled;

    expect(cycled).toMatchObject({ status: 'cycled', acquired: 200 });
    expect(counts).toMatchObject({ status: 'polled', refused: 0 });
    expect(counts.connected).toBeGreaterThan(0);
  }, 60_000);
});
