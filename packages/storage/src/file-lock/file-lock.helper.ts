import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { now } from '@sheavly/core/clock/clock.helper';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';
import { StorageFileError } from '../errors/storage.errors.js';
import { PRIVATE_FOLDER_MODE } from '../json-file/json-file.constants.js';
import { LOCK_POLL_MS, LOCK_STALE_MS, LOCK_SUFFIX, LOCK_WAIT_MS } from './file-lock.constants.js';

/**
 * Runs `task` while holding the lock `<name>.lock`, so two processes changing what it guards
 * (a file read and written back whole) never overlap. Waits up to `LOCK_WAIT_MS` for another
 * holder, then throws a `StorageFileError` naming the lock file. A lock whose process is gone (or
 * that was never finished and is older than `LOCK_STALE_MS`) is taken over; a live holder keeps
 * its lock however long the task takes. The lock is released when `task` ends,
 * however it ended. Within one process, order calls with a `SerialQueue` first: this guards
 * against other processes, not other callers.
 */
export async function withFileLock<T>(params: {
  name: string;
  task: () => Promise<T>;
}): Promise<T> {
  const lock = `${params.name}${LOCK_SUFFIX}`;
  // The lock says who holds it (`<pid>:<token>`), so a release removes only its own lock, never
  // one a later holder made after taking this one over.
  const mine = `${String(process.pid)}:${randomUUID()}`;

  await acquire({ lock, mine });

  try {
    return await params.task();
  } finally {
    await release({ lock, mine });
  }
}

async function acquire(params: { lock: string; mine: string }): Promise<void> {
  const { lock, mine } = params;
  const deadline = now() + LOCK_WAIT_MS;

  await mkdir(path.dirname(lock), { recursive: true, mode: PRIVATE_FOLDER_MODE });

  while (!(await tryCreate({ lock, mine }))) {
    if (now() > deadline) {
      throw new StorageFileError({
        file: lock,
        cause: undefined,
        reason: `another process has held this lock for over ${String(LOCK_WAIT_MS / 1000)} seconds. If none is running, delete the file`,
      });
    }

    const stale = await staleHolder(lock);

    if (stale === undefined) await sleep(LOCK_POLL_MS);
    else await takeOver({ lock, stale });
  }
}

/** True when this call made the lock file; false when it is already there. */
async function tryCreate(params: { lock: string; mine: string }): Promise<boolean> {
  const { lock, mine } = params;
  let handle;

  try {
    handle = await open(lock, 'wx', 0o600);
  } catch (caughtError) {
    if (errorCode(caughtError) === 'EEXIST') return false;
    throw new StorageFileError({ file: lock, cause: caughtError });
  }

  try {
    await handle.writeFile(mine);
  } catch (caughtError) {
    // A half-made lock would block every waiter until it aged out: take it away, then close.
    await rm(lock, { force: true });
    await handle.close();
    throw new StorageFileError({ file: lock, cause: caughtError });
  }

  await handle.close();

  return true;
}

/** Removes the lock only while it is still this holder's. */
async function release(params: { lock: string; mine: string }): Promise<void> {
  try {
    if ((await readFile(params.lock, 'utf8')) === params.mine) {
      await rm(params.lock, { force: true });
    }
  } catch (caughtError) {
    if (errorCode(caughtError) !== 'ENOENT') {
      throw new StorageFileError({ file: params.lock, cause: caughtError });
    }
  }
}

/**
 * What the lock file held when it was judged stale, or `undefined` when its holder may be alive.
 * Held by a process that is gone is stale. A lock with no readable holder (a crash between
 * creating and writing it) is stale once it is older than `LOCK_STALE_MS`. A live holder's lock
 * is never taken over by age: a slow change keeps its lock.
 */
async function staleHolder(lock: string): Promise<string | undefined> {
  try {
    const held = await readFile(lock, 'utf8');
    const pid = Number.parseInt(held.split(':')[0] ?? '', 10);

    if (Number.isNaN(pid)) {
      return now() - (await stat(lock)).mtimeMs > LOCK_STALE_MS ? held : undefined;
    }

    return isRunning(pid) ? undefined : held;
  } catch (caughtError) {
    // Gone between the look and the read: the holder released it, so try to take it again.
    if (errorCode(caughtError) === 'ENOENT') return undefined;
    throw new StorageFileError({ file: lock, cause: caughtError });
  }
}

/**
 * Clears the lock that held `stale`. Moved aside in one step (a rename), then checked: if what
 * was moved is not what was judged stale, another waiter had already replaced it and this took a
 * live lock, so it is put back. Removing in place would delete the other waiter's new lock.
 * An unfinished lock (empty) matches by content alone, so it must also be old: a fresh lock is
 * briefly empty between its creation and its token. Putting a live lock back is best effort: in
 * the instant between the rename and the link a third waiter can create its own, and then the
 * put-back is dropped; that narrow window is accepted over holding a second lock to close it.
 */
async function takeOver(params: { lock: string; stale: string }): Promise<void> {
  const { lock, stale } = params;
  const aside = `${lock}.${randomUUID()}.stale`;

  try {
    await rename(lock, aside);
  } catch (caughtError) {
    if (errorCode(caughtError) === 'ENOENT') return;
    throw new StorageFileError({ file: lock, cause: caughtError });
  }

  try {
    const held = await readFile(aside, 'utf8');
    const old = held !== '' || now() - (await stat(aside)).mtimeMs > LOCK_STALE_MS;

    if (held !== stale || !old) await restore({ aside, lock });
  } finally {
    await rm(aside, { force: true });
  }
}

/** Puts a live lock taken by mistake back, unless someone has made a new one meanwhile. */
async function restore(params: { aside: string; lock: string }): Promise<void> {
  try {
    await link(params.aside, params.lock);
  } catch (caughtError) {
    if (errorCode(caughtError) !== 'EEXIST') {
      throw new StorageFileError({ file: params.lock, cause: caughtError });
    }
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (caughtError) {
    // EPERM means the process exists but is another user's.
    return errorCode(caughtError) === 'EPERM';
  }
}
