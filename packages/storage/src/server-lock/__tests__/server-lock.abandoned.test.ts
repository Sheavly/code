import { lstat, mkdir, readdir, readFile, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { now } from '@sheavly/core/clock/clock.helper';
import { useWorkers } from '../testing/server-lock-children.fake.js';
import { useLockPlace } from '../testing/server-lock-place.fake.js';

const lock = useLockPlace();
const workers = useWorkers();
const { place, lockPath, acquire } = lock;
const posix = describe.skipIf(process.platform === 'win32');
const CONTENDERS = 4;
const ROUNDS = 150;
const LONG_AGO_S = 60;

async function timedAcquire(where: { home: string; runtimeDir: string }) {
  const started = performance.now();
  const result = await acquire(where);

  return { result, tookMs: performance.now() - started };
}

posix('contenders racing from a stale socket and a guard left by a dead process', () => {
  it(`give exactly one winner in each of ${String(ROUNDS)} rounds, its socket untouched`, async () => {
    const base = place().runtimeDir;

    for (let index = 0; index < ROUNDS; index += 1) {
      await mkdir(path.join(base, `round-${String(index)}`), { mode: 0o700 });
    }

    const stale = workers.start(['hold-many', base, String(ROUNDS)]);

    await workers.nextEvent(stale);
    await workers.kill(stale);

    const racers = await workers.startRacers(CONTENDERS);

    for (let index = 0; index < ROUNDS; index += 1) {
      const home = path.join(base, `round-${String(index)}`);
      const guard = `${await lockPath({ home, runtimeDir: home })}.guard`;
      const longAgo = now() / 1000 - LONG_AGO_S;

      await writeFile(guard, 'left by a process that died');
      await utimes(guard, longAgo, longAgo);

      const events = await workers.raceFor({ racers, home });
      const winner = events.find((event) => event.status === 'acquired');

      expect(events.map((event) => event.status).sort(), `round ${String(index)}`).toEqual([
        'acquired',
        'held',
        'held',
        'held',
      ]);
      expect((await lstat(winner?.path ?? '')).ino, `round ${String(index)}`).toBe(winner?.ino);
      expect(await lock.exists(guard), `round ${String(index)}`).toBe(false);

      await workers.releaseAll(racers);
    }
  }, 240_000);
});

posix('a guard path that cannot be waited for or stolen', () => {
  it('is reported at once as unusable when it is a directory, which is left as it is', async () => {
    const where = place();
    const socket = await lockPath(where);
    const guard = `${socket}.guard`;

    await workers.leaveStaleSocket(where);
    await mkdir(guard);
    await writeFile(path.join(guard, 'inside'), 'kept');

    const started = performance.now();
    const result = await acquire(where);
    const tookMs = performance.now() - started;

    expect(result).toEqual({ status: 'unusable', path: socket, reason: 'unexpected' });
    expect(tookMs).toBeLessThan(1000);
    expect(await readdir(guard)).toEqual(['inside']);
    expect((await lstat(socket)).isSocket()).toBe(true);
  }, 30_000);
});

posix('an abandoned guard whose breaker path holds something that is not a regular file', () => {
  it.each(['symlink', 'directory'])(
    'is reported at once as unusable when the breaker is a %s, which is left as it is',
    async (kind) => {
      const where = place();
      const socket = await lockPath(where);
      const guard = `${socket}.guard`;
      const breaker = `${guard}.breaker`;
      const victim = path.join(where.runtimeDir, 'victim.txt');
      const longAgo = now() / 1000 - LONG_AGO_S;

      await workers.leaveStaleSocket(where);
      await writeFile(guard, 'left by a process that died');
      await utimes(guard, longAgo, longAgo);
      await writeFile(victim, 'kept');

      if (kind === 'symlink') {
        await symlink(victim, breaker);
      } else {
        await mkdir(breaker);
        await writeFile(path.join(breaker, 'inside'), 'kept');
      }

      const { result, tookMs } = await timedAcquire(where);

      expect(result).toEqual({ status: 'unusable', path: socket, reason: 'unexpected' });
      expect(tookMs).toBeLessThan(1000);
      expect(await readFile(victim, 'utf8')).toBe('kept');
      expect((await lstat(breaker))[kind === 'symlink' ? 'isSymbolicLink' : 'isDirectory']()).toBe(
        true,
      );
      expect((await lstat(socket)).isSocket()).toBe(true);
      expect(await lock.exists(guard)).toBe(true);
    },
    30_000,
  );
});

posix('a guard left by a dead process', () => {
  it('is stolen after two seconds, so starting behind it is delayed by about that much', async () => {
    const where = place();
    const socket = await lockPath(where);

    await workers.leaveStaleSocket(where);
    await writeFile(`${socket}.guard`, 'left by a process that died');

    const started = performance.now();
    const result = await acquire(where);
    const tookMs = performance.now() - started;

    expect(result).toMatchObject({ status: 'acquired', path: socket });
    expect(tookMs).toBeGreaterThan(1500);
    expect(tookMs).toBeLessThan(4000);
  }, 30_000);
});
