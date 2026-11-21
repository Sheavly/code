import type { ChildProcess } from 'node:child_process';
import { mkdir, lstat } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { now } from '@sheavly/core/clock/clock.helper';
import { useWorkers } from '../testing/server-lock-children.fake.js';
import { useLockPlace } from '../testing/server-lock-place.fake.js';

const { place, lockPath, acquire } = useLockPlace();
const workers = useWorkers();
const posix = describe.skipIf(process.platform === 'win32');
const RACERS = 8;
const ROUNDS = 50;
/** Long enough for every racer to receive the start time before it passes. */
const START_DELAY_MS = 150;

const connects = (file: string): Promise<string> =>
  new Promise((resolve) => {
    const socket = net.connect(file);

    socket.once('connect', () => {
      socket.destroy();
      resolve('connected');
    });
    socket.once('error', (caughtError: Error & { code?: string }) => {
      resolve(caughtError.code ?? 'error');
    });
  });

posix('a process killed while holding the lock', () => {
  it('leaves a socket file that the next start replaces', async () => {
    const where = place();
    const target = await lockPath(where);
    const child = workers.start(['hold', where.home, where.runtimeDir]);

    expect((await workers.nextEvent(child)).status).toBe('acquired');
    await workers.kill(child);

    expect((await lstat(target)).isSocket()).toBe(true);
    expect(await connects(target)).toBe('ECONNREFUSED');

    const result = await acquire(where);

    expect(result).toMatchObject({ status: 'acquired', path: target });
    expect(await connects(target)).toBe('connected');
  }, 30_000);
});

async function round(params: { racers: ChildProcess[]; index: number; stale: boolean }) {
  const { racers, index, stale } = params;
  const home = path.join(place().runtimeDir, `round-${String(index)}`);

  await mkdir(home, { mode: 0o700 });

  if (stale) await workers.leaveStaleSocket({ home, runtimeDir: home });

  const answers = racers.map((racer) => workers.nextEvent(racer));
  const startAt = now() + START_DELAY_MS;

  for (const racer of racers) racer.send({ home, runtimeDir: home, startAt });

  return { home, events: await Promise.all(answers) };
}

posix('eight processes taking the same lock at the same moment', () => {
  it(`give exactly one winner in each of ${String(ROUNDS)} rounds, half starting from a stale socket`, async () => {
    const racers = Array.from({ length: RACERS }, () => workers.start(['racer']));

    await Promise.all(racers.map((racer) => workers.nextEvent(racer)));

    for (let index = 0; index < ROUNDS; index += 1) {
      const { home, events } = await round({ racers, index, stale: index % 2 === 1 });
      const statuses = events.map((event) => event.status).sort();
      const winner = events.find((event) => event.status === 'acquired');

      expect(statuses, `round ${String(index)}`).toEqual(
        ['acquired', ...Array.from({ length: RACERS - 1 }, () => 'held')].sort(),
      );

      // A loser must never have removed the winner's socket: it is still the same file.
      expect((await lstat(winner?.path ?? '')).ino, `round ${String(index)}`).toBe(winner?.ino);
      expect(winner?.path?.startsWith(home)).toBe(true);

      const released = racers.map((racer) => workers.nextEvent(racer));

      for (const racer of racers) racer.send({ release: true });

      await Promise.all(released);
    }
  }, 180_000);
});
