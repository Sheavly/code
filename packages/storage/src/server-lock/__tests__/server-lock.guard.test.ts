import { readdir, readFile, unlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { now } from '@sheavly/core/clock/clock.helper';
import { dropGuard, takeGuard } from '../server-guard.helper.js';
import { useWorkers } from '../testing/server-lock-children.fake.js';
import { useLockPlace } from '../testing/server-lock-place.fake.js';

const { place, lockPath, acquire, exists } = useLockPlace();
const workers = useWorkers();
const posix = describe.skipIf(process.platform === 'win32');

/** A stale socket at the lock path, and a guard file beside it as if another process held it. */
async function staleSocketWithGuard() {
  const where = place();
  const socket = await lockPath(where);
  const guard = `${socket}.guard`;

  await workers.leaveStaleSocket({ home: where.home, runtimeDir: where.runtimeDir });
  await writeFile(guard, '');

  return { where, socket, guard };
}

const GUARD_ROUNDS = 50;
const longAgo = () => now() / 1000 - 60;

/** A guard file path in the test's folder, left by a process that died holding it. */
async function abandonedGuard(): Promise<string> {
  const guard = `${await lockPath(place())}.guard`;

  await writeFile(guard, 'left by a process that died');
  await utimes(guard, longAgo(), longAgo());

  return guard;
}

posix('a guard file that was stolen', () => {
  it('is not deleted by the slow holder it was stolen from, only by its new owner', async () => {
    const guard = await abandonedGuard();
    const timing = { guard, deadlineMs: 500, staleMs: 1000, now };
    const first = await takeGuard({ ...timing, deadlineMs: 0 });

    if (first.status !== 'taken') throw new Error('the abandoned guard was not stolen');

    await utimes(guard, longAgo(), longAgo());

    const second = await takeGuard(timing);

    if (second.status !== 'taken') throw new Error('the aged guard was not stolen');

    await dropGuard(first.guard);

    expect(await readFile(guard, 'utf8')).toBe(second.guard.nonce);

    await dropGuard(second.guard);

    expect(await exists(guard)).toBe(false);
  });

  it(`goes to exactly one of four contenders, in each of ${String(GUARD_ROUNDS)} rounds`, async () => {
    for (let round = 0; round < GUARD_ROUNDS; round += 1) {
      const guard = await abandonedGuard();
      const outcomes = await Promise.all(
        Array.from({ length: 4 }, () => takeGuard({ guard, deadlineMs: 60, staleMs: 1000, now })),
      );
      const taken = outcomes.filter((outcome) => outcome.status === 'taken');

      expect(taken, `round ${String(round)}`).toHaveLength(1);
      expect(await readFile(guard, 'utf8')).toBe(
        taken[0]?.status === 'taken' ? taken[0].guard.nonce : '',
      );
      expect(
        (await readdir(path.dirname(guard))).filter((name) => name.includes('.guard.')),
      ).toEqual([]);

      await unlink(guard);
    }
  }, 60_000);
});

posix('replacing a stale socket under the guard file', () => {
  it('waits for a guard that is held, then gives up after its attempts without touching anything', async () => {
    const { where, socket, guard } = await staleSocketWithGuard();
    const result = await acquire({ ...where, guardTimeoutMs: 40 });

    expect(result).toEqual({ status: 'unusable', path: socket, reason: 'retries-exhausted' });
    expect(await exists(socket)).toBe(true);
    expect(await exists(guard)).toBe(true);
  }, 30_000);

  it('goes on to take the lock when the guard is released while it waits', async () => {
    const { where, socket, guard } = await staleSocketWithGuard();
    const release = setTimeout(() => {
      void unlink(guard);
    }, 150);
    const result = await acquire({ ...where, guardTimeoutMs: 5000 });

    clearTimeout(release);

    expect(result).toMatchObject({ status: 'acquired', path: socket });
    expect(await exists(guard)).toBe(false);
  }, 30_000);

  it('steals a guard older than the stale limit, and releases it when done', async () => {
    const { where, socket, guard } = await staleSocketWithGuard();
    const result = await acquire({
      ...where,
      guardStaleMs: 10_000,
      now: () => now() + 60_000,
    });

    expect(result).toMatchObject({ status: 'acquired', path: socket });
    expect(await exists(guard)).toBe(false);
  }, 30_000);
});
