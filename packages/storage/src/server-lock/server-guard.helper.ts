import type { Stats } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { lstat, open, readFile, unlink } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';
import {
  BREAKER_SUFFIX,
  GUARD_FILE_MODE,
  GUARD_POLL_JITTER_MS,
  GUARD_POLL_MS,
} from './server-lock.constants.js';
import type { Guard, GuardOutcome } from './server-lock.types.js';
import { lstatOrUndefined } from './server-publish.helper.js';

type GuardTiming = { deadlineMs: number; staleMs: number; now: () => number };

/** What a look at an existing guard found: gone (look again), still held, or not a guard at all. */
type GuardLook = 'gone' | 'held' | 'not-a-file';

/**
 * Takes the guard file with `O_EXCL`, so one process at a time replaces a stale socket. The file
 * holds the taker's nonce, so only the taker can drop it. Waits up to `deadlineMs`; a guard older
 * than `staleMs` was left by a process that died holding it and is stolen. Anything that is not a
 * regular file at the guard path is never waited for. Anything else that goes wrong throws.
 */
export async function takeGuard(params: { guard: string } & GuardTiming): Promise<GuardOutcome> {
  const { guard, deadlineMs, staleMs, now } = params;
  const nonce = randomBytes(8).toString('hex');
  const giveUpAt = now() + deadlineMs;

  for (;;) {
    const created = await createGuard({ guard, nonce });

    if (created !== undefined) {
      return { status: 'taken', guard: { path: guard, nonce, ...created } };
    }

    const look = await lookAtGuard({ guard, staleMs, now, nonce });

    if (look === 'not-a-file') return { status: 'not-a-file' };

    if (look === 'gone') continue;

    if (now() > giveUpAt) return { status: 'timeout' };

    await sleep(GUARD_POLL_MS + Math.random() * GUARD_POLL_JITTER_MS);
  }
}

/**
 * Removes the guard file only if it still carries this taker's nonce: a slow holder whose guard
 * was stolen must not delete its successor's. A guard already gone is fine; any other error
 * throws, and the caller decides whether that matters.
 */
export async function dropGuard(guard: Pick<Guard, 'path' | 'nonce'>): Promise<void> {
  try {
    if ((await readFile(guard.path, 'utf8')) !== guard.nonce) return;

    await unlink(guard.path);
  } catch (caughtError) {
    if (errorCode(caughtError) !== 'ENOENT') throw caughtError;
  }
}

/**
 * Whether the guard is still the file this holder made: same inode, same mtime, same nonce. A
 * holder calls it right before it acts, because a guard it kept past the stale limit may have
 * been stolen. A guard gone is not held.
 */
export async function holdsGuard(guard: Guard): Promise<boolean> {
  try {
    const found = await lstat(guard.path);

    if (!found.isFile() || found.ino !== guard.ino || found.mtimeMs !== guard.mtimeMs) {
      return false;
    }

    return (await readFile(guard.path, 'utf8')) === guard.nonce;
  } catch (caughtError) {
    if (errorCode(caughtError) === 'ENOENT') return false;

    throw caughtError;
  }
}

/** Creates the file holding `nonce` and returns what identifies it, or undefined when it exists. */
async function createGuard(params: {
  guard: string;
  nonce: string;
}): Promise<Pick<Guard, 'ino' | 'mtimeMs'> | undefined> {
  try {
    const handle = await open(params.guard, 'wx', GUARD_FILE_MODE);

    try {
      await handle.writeFile(params.nonce);

      const { ino, mtimeMs } = await handle.stat();

      return { ino, mtimeMs };
    } finally {
      await handle.close();
    }
  } catch (caughtError) {
    if (errorCode(caughtError) === 'EEXIST') return undefined;

    throw caughtError;
  }
}

async function lookAtGuard(params: {
  guard: string;
  staleMs: number;
  now: () => number;
  nonce: string;
}): Promise<GuardLook> {
  const { guard, staleMs, now, nonce } = params;
  let found: Stats;

  try {
    found = await lstat(guard);
  } catch (caughtError) {
    // Released between the failed create and the look: nothing to wait for, try again.
    if (errorCode(caughtError) === 'ENOENT') return 'gone';

    throw caughtError;
  }

  if (!found.isFile()) return 'not-a-file';

  if (now() - found.mtimeMs <= staleMs) return 'held';

  const stolen = await stealAbandoned({ guard, seen: found, staleMs, now, nonce });

  if (stolen === 'busy') return 'held';

  return stolen === 'not-a-file' ? 'not-a-file' : 'gone';
}

/**
 * Removes the abandoned guard that was seen, one stealer at a time: whoever holds the breaker file
 * looks at the guard again and removes it only if it is still the file that was seen and still
 * old. Removing it by name without that would let a slow stealer delete a fresh guard another
 * contender just made. `busy` when another stealer holds the breaker; `not-a-file` when the
 * breaker path holds something that is not a regular file, which no wait would ever clear.
 */
async function stealAbandoned(params: {
  guard: string;
  seen: Stats;
  staleMs: number;
  now: () => number;
  nonce: string;
}): Promise<'stolen' | 'busy' | 'not-a-file'> {
  const { guard, seen, staleMs, now, nonce } = params;
  const breaker = { path: `${guard}${BREAKER_SUFFIX}`, nonce };

  if ((await createGuard({ guard: breaker.path, nonce })) === undefined) {
    return clearAbandonedBreaker({ breaker: breaker.path, staleMs, now });
  }

  try {
    const current = await lstatOrUndefined(guard);

    if (current?.ino === seen.ino && current.mtimeMs === seen.mtimeMs) {
      await unlinkQuietly(guard);
    }
  } finally {
    await dropGuard(breaker);
  }

  return 'stolen';
}

/** A breaker file is held for a few system calls, so one that stayed was left by a dead process. */
async function clearAbandonedBreaker(params: {
  breaker: string;
  staleMs: number;
  now: () => number;
}): Promise<'busy' | 'not-a-file'> {
  const { breaker, staleMs, now } = params;
  const found = await lstatOrUndefined(breaker);

  if (found !== undefined && !found.isFile()) return 'not-a-file';

  if (found !== undefined && now() - found.mtimeMs > staleMs) await unlinkQuietly(breaker);

  return 'busy';
}

async function unlinkQuietly(file: string): Promise<void> {
  try {
    await unlink(file);
  } catch (caughtError) {
    if (errorCode(caughtError) !== 'ENOENT') throw caughtError;
  }
}
