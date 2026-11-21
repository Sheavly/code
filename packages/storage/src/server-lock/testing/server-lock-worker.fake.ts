import { lstat } from 'node:fs/promises';
import net from 'node:net';
import { now } from '@sheavly/core/clock/clock.helper';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';
import { acquireServerLock } from '../server-lock.helper.js';
import type { ServerLockResult } from '../server-lock.types.js';
import { temporarySocketPath } from '../server-lock.utils.js';
import { listenOnce } from '../server-socket.helper.js';
import { connectOutcome } from './server-lock-connect.fake.js';

/**
 * Test-only: forked as a child process by the server lock tests, which hear each event as an IPC
 * message. `argv`: a mode, then its arguments.
 * - `racer`: says `ready`, then for each `{ home, runtimeDir, startAt }` message waits for the
 *   start time (epoch ms), takes the lock and reports the outcome; a won lock is kept until a
 *   `release` message. Reusing one process for many rounds keeps a 50-round race affordable.
 * - `hold <home> <runtimeDir>`: takes the lock, reports it, and never lets go (the test kills it).
 * - `frozen <path>`: listens with a backlog of one and says `ready`; the test then stops the
 *   process, so connects to it neither succeed nor fail.
 * - `poll <path>`: says `ready`, then looks at the path and connects to what it finds as fast as
 *   it can; on any message it says how many connects were accepted and how many refused.
 * - `cycle <home> <runtimeDir> <count>`: takes and releases the lock `count` times, then says so.
 * - `temporaries <socketPath> <count>`: listens under `count` temporary names of that lock socket,
 *   says which, and never lets go (the test kills it, leaving the files as a crash would).
 * - `hold-many <base> <count>`: takes the lock of `<base>/round-<n>` (each its own home and runtime
 *   folder, made beforehand) for each n, says so, and never lets go (the test kills it).
 */
type RacerCommand = { home?: string; runtimeDir?: string; startAt?: number; release?: true };

const [mode = '', first = '', second = '', third = ''] = process.argv.slice(2);
let held: Extract<ServerLockResult, { status: 'acquired' }> | undefined;

function say(event: Record<string, unknown>): void {
  process.send?.(event);
}

async function race(command: RacerCommand): Promise<void> {
  // A spin, not a timer: processes started a few milliseconds apart must contend together.
  while (now() < (command.startAt ?? 0)) {
    // Waiting for the shared start time.
  }

  const result = await acquireServerLock({
    home: command.home ?? '',
    runtimeDir: command.runtimeDir ?? '',
  });

  if (result.status !== 'acquired') {
    say({ status: result.status, reason: 'reason' in result ? result.reason : undefined });

    return;
  }

  held = result;
  say({ status: result.status, path: result.path, ino: await inodeOf(result.path) });
}

/** The socket's inode, or undefined when it is already gone: the test reports that as a failure. */
async function inodeOf(file: string): Promise<number | undefined> {
  try {
    return (await lstat(file)).ino;
  } catch (caughtError) {
    if (errorCode(caughtError) === 'ENOENT') return undefined;

    throw caughtError;
  }
}

async function handle(command: RacerCommand): Promise<void> {
  if (command.release) {
    await held?.release();
    held = undefined;
    say({ status: 'released' });

    return;
  }

  await race(command);
}

/** What one look at the lock path, then a connect to it, found. */
async function lookAndConnect(file: string): Promise<'absent' | 'connected' | 'refused'> {
  if ((await inodeOf(file)) === undefined) return 'absent';

  const outcome = await connectOutcome(file);

  if (outcome === 'connected') return outcome;

  return outcome === 'ECONNREFUSED' ? 'refused' : 'absent';
}

/** Polls the lock path as fast as it can until told to stop, counting what a connect found. */
function poll(file: string): void {
  const counts = { connected: 0, refused: 0 };
  let stopped = false;

  process.once('message', () => {
    stopped = true;
  });

  void (async () => {
    while (!stopped) {
      const seen = await lookAndConnect(file);

      if (seen !== 'absent') counts[seen] += 1;
    }

    say({ status: 'polled', ...counts });
  })();

  say({ status: 'ready' });
}

/** Takes and releases the lock `count` times, holding it a few milliseconds each time. */
async function cycle(params: { home: string; runtimeDir: string; count: number }): Promise<void> {
  let acquiredCount = 0;

  for (let index = 0; index < params.count; index += 1) {
    const result = await acquireServerLock(params);

    if (result.status === 'acquired') {
      acquiredCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 3));
      await result.release();
    }
  }

  say({ status: 'cycled', acquired: acquiredCount });
}

/** Takes the lock of `<base>/round-<n>` (its own runtime folder) for each n, and never lets go. */
async function holdMany(params: { base: string; count: number }): Promise<void> {
  const kept: unknown[] = [];

  for (let index = 0; index < params.count; index += 1) {
    const home = `${params.base}/round-${String(index)}`;

    kept.push(await acquireServerLock({ home, runtimeDir: home }));
  }

  say({ status: 'acquired', kept: kept.length });
  await new Promise(() => undefined);
}

/** Listens under `count` temporary names of the lock socket `file` and says which, never letting go. */
async function holdTemporaries(params: { file: string; count: number }): Promise<void> {
  const names: string[] = [];

  for (let index = 0; index < params.count; index += 1) {
    const name = temporarySocketPath(params.file);

    await listenOnce(name);
    names.push(name);
  }

  say({ status: 'temporaries', names });
  await new Promise(() => undefined);
}

if (mode === 'poll') {
  poll(first);
} else if (mode === 'temporaries') {
  await holdTemporaries({ file: first, count: Number(second) });
} else if (mode === 'cycle') {
  await cycle({ home: first, runtimeDir: second, count: Number(third) });
} else if (mode === 'hold-many') {
  await holdMany({ base: first, count: Number(second) });
} else if (mode === 'frozen') {
  net.createServer().listen({ path: first, backlog: 1 }, () => {
    say({ status: 'ready' });
  });
} else if (mode === 'hold') {
  const result = await acquireServerLock({ home: first, runtimeDir: second });

  say({ status: result.status });
  await new Promise(() => undefined);
} else {
  process.on('message', (command: RacerCommand) => {
    void handle(command);
  });
  say({ status: 'ready' });
}
