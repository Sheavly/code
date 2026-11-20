import type { Stats } from 'node:fs';
import { chmod } from 'node:fs/promises';
import type { Server } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { now as clockNow } from '@sheavly/core/clock/clock.helper';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';
import { checkPrivateDirectory, serverNameHash } from '../server-runtime/server-runtime.helper.js';
import { SOCKET_MODE } from '../server-runtime/server-runtime.constants.js';
import { serverEndpoint, socketPathBytes } from '../server-runtime/server-runtime.utils.js';
import { dropGuard, holdsGuard, takeGuard } from './server-guard.helper.js';
import {
  GUARD_DEADLINE_MS,
  GUARD_STALE_MS,
  LOCK_ATTEMPTS,
  LOCK_PATH_MAX_BYTES,
  PROBE_TIMEOUT_MS,
  SOCKET_GRACE_MS,
  TEMP_NAME_EXTRA_BYTES,
} from './server-lock.constants.js';
import type {
  AcquireServerLockParams,
  Candidate,
  Guard,
  Publication,
  ServerLockResult,
  SocketIdentity,
} from './server-lock.types.js';
import {
  guardPath,
  identityOf,
  isOurSocket,
  listenFailureReason,
  temporarySocketPath,
} from './server-lock.utils.js';
import {
  discardCandidate,
  lstatOrUndefined,
  publishCandidate,
  releaseSocket,
  unlinkIfSame,
} from './server-publish.helper.js';
import { listenOnce, probeSocket } from './server-socket.helper.js';
import { sweepAbandonedSockets } from './server-temp-sweep.helper.js';

type Attempt = {
  path: string;
  uid: number;
  now: () => number;
  guardTimeoutMs: number;
  guardStaleMs: number;
  probeTimeoutMs: number;
};

/** The result of one step: a final answer, or `retry` to go round again. */
type Step = ServerLockResult | 'retry';

/**
 * Takes the single-server lock of `home`: a socket in `runtimeDir` named by the hash of the home's
 * real path, listened on for as long as the result is held. Never throws; an unexpected error is
 * `unusable` with the error in `cause`. Only `held` (a live server owns this home) should stop a
 * server from starting; every other outcome that is not `acquired` is a warning. The server
 * listens under a temporary name and is then published at the lock path with an atomic hard link,
 * so that name only ever appears once a server is listening behind it and is never overwritten. The
 * socket is set to 0600 before it is published, whatever the umask. A
 * socket file left by a killed process is replaced under a guard file, so two contenders never both
 * win and a live socket is never removed. The Windows branch (a named pipe, no folder checks, no
 * guard, nothing to unlink) is written but not tested.
 */
export async function acquireServerLock(
  params: AcquireServerLockParams,
): Promise<ServerLockResult> {
  try {
    return await acquireChecked(params);
  } catch (caughtError) {
    return { status: 'unusable', reason: 'unexpected', cause: caughtError };
  }
}

async function acquireChecked(params: AcquireServerLockParams): Promise<ServerLockResult> {
  const { home, runtimeDir, platform = process.platform } = params;
  const windows = platform === 'win32';

  // Before any file system call: the path's length does not depend on the hash. The temporary
  // name is longer than the lock path, so it is the one that must fit.
  if (!windows && socketPathBytes(runtimeDir) + TEMP_NAME_EXTRA_BYTES > LOCK_PATH_MAX_BYTES) {
    return { status: 'unusable', reason: 'path-too-long' };
  }

  const uid = windows ? 0 : (process.getuid?.() ?? 0);

  if (!windows) {
    const check = await checkPrivateDirectory({ directory: runtimeDir, uid });

    if (check.status === 'refused') {
      return { status: 'unusable', reason: check.problem, cause: check.cause };
    }
  }

  const hash = await serverNameHash({ home });
  const path = serverEndpoint({ platform, runtimeDir, hash });
  const attempt: Attempt = {
    path,
    uid,
    now: params.now ?? clockNow,
    guardTimeoutMs: params.guardTimeoutMs ?? GUARD_DEADLINE_MS,
    guardStaleMs: params.guardStaleMs ?? GUARD_STALE_MS,
    probeTimeoutMs: params.probeTimeoutMs ?? PROBE_TIMEOUT_MS,
  };

  return windows ? listenOnPipe(path) : acquireSocket(attempt);
}

/** A named pipe vanishes with its process, so there is nothing stale to find or remove. */
async function listenOnPipe(path: string): Promise<ServerLockResult> {
  const listening = await listenOnce(path);

  if (listening.status === 'listening') {
    return acquired({ server: listening.server, path, identity: undefined, uid: 0 });
  }

  return listening.code === 'EADDRINUSE'
    ? { status: 'held', path }
    : { status: 'unusable', path, reason: 'unexpected', cause: listening.error };
}

/**
 * Listens under a temporary name and tries to publish it. Whatever the outcome, unless the lock
 * was acquired the server is closed again, also when a step throws: a server left listening would
 * hold the lock and keep the process alive with no one to release it.
 */
async function acquireSocket(attempt: Attempt): Promise<ServerLockResult> {
  await sweepAbandonedSockets({ socketPath: attempt.path, uid: attempt.uid });

  const temporaryPath = temporarySocketPath(attempt.path);
  const listening = await listenOnce(temporaryPath);

  if (listening.status === 'failed') return listenFailed({ attempt, outcome: listening });

  const candidate: Candidate = { server: listening.server, temporaryPath };
  let result: ServerLockResult | undefined;

  try {
    // The link shares the inode, so the lock path gets this mode too; the umask is not changed
    // because it is process-wide. A failure here closes the server like any after listen.
    await chmod(temporaryPath, SOCKET_MODE);
    result = await publishWithRetries({ attempt, candidate });

    return result;
  } finally {
    if (result?.status !== 'acquired') await discardCandidate(candidate);
  }
}

async function publishWithRetries(params: {
  attempt: Attempt;
  candidate: Candidate;
}): Promise<ServerLockResult> {
  const { attempt, candidate } = params;

  for (let tries = 0; tries < LOCK_ATTEMPTS; tries += 1) {
    const step = await tryPublish({ attempt, candidate });

    if (step !== 'retry') return step;
  }

  return { status: 'unusable', path: attempt.path, reason: 'retries-exhausted' };
}

async function tryPublish(params: { attempt: Attempt; candidate: Candidate }): Promise<Step> {
  const { attempt, candidate } = params;
  const publication = await publishCandidate({
    candidate,
    path: attempt.path,
    uid: attempt.uid,
  });

  if (publication.status === 'exists') return judgeExisting({ attempt, candidate });

  return settle({ attempt, candidate, publication });
}

/** The step a publication ends in: the lock, a failure, or (a name taken meanwhile) another go. */
function settle(params: {
  attempt: Attempt;
  candidate: Candidate;
  publication: Publication;
}): Step {
  const { attempt, candidate, publication } = params;

  if (publication.status === 'published') {
    return acquired({
      server: candidate.server,
      path: attempt.path,
      identity: publication.identity,
      uid: attempt.uid,
    });
  }

  if (publication.status === 'exists') return 'retry';

  return {
    status: 'unusable',
    path: attempt.path,
    reason: publication.reason,
    cause: publication.error,
  };
}

/** Something is at the lock path: only a live server (held) or a stale socket of ours is not an error. */
async function judgeExisting(params: { attempt: Attempt; candidate: Candidate }): Promise<Step> {
  const { attempt, candidate } = params;
  const found = await lstatOrUndefined(attempt.path);

  if (found === undefined) return 'retry';

  if (!isOurSocket({ found, uid: attempt.uid })) return notOurSocket(attempt.path);

  return (await probeVerdict({ attempt, found })) ?? replaceStale({ attempt, candidate });
}

/**
 * The answer a probe settles (held, or inconclusive), or undefined when the socket is stale. A
 * socket that refuses but changed a moment ago may be between `bind` and `listen` in a program
 * that does not publish atomically, so it gets until it is `SOCKET_GRACE_MS` old and is probed
 * once more before it is called stale.
 */
async function probeVerdict(params: {
  attempt: Attempt;
  found: Stats;
}): Promise<ServerLockResult | undefined> {
  const { attempt, found } = params;
  const first = await probeOnce(attempt);

  if (first !== 'stale') return first;

  const youngFor = SOCKET_GRACE_MS - (attempt.now() - found.ctimeMs);

  if (youngFor <= 0) return undefined;

  await sleep(Math.min(youngFor, SOCKET_GRACE_MS));

  const second = await probeOnce(attempt);

  return second === 'stale' ? undefined : second;
}

async function probeOnce(attempt: Attempt): Promise<ServerLockResult | 'stale'> {
  const { path, probeTimeoutMs } = attempt;
  const probe = await probeSocket({ path, timeoutMs: probeTimeoutMs });

  if (probe === 'live') return { status: 'held', path };

  return probe === 'unknown' ? inconclusive(path) : 'stale';
}

/**
 * Replaces a socket file that looked stale. Under the guard everything is looked at again, because
 * another contender may have replaced it and be listening by now; and the file is removed only if
 * it is still the file that was judged stale.
 */
async function replaceStale(params: { attempt: Attempt; candidate: Candidate }): Promise<Step> {
  const { attempt, candidate } = params;
  const taken = await takeGuard({
    guard: guardPath(attempt.path),
    deadlineMs: attempt.guardTimeoutMs,
    staleMs: attempt.guardStaleMs,
    now: attempt.now,
  });

  if (taken.status === 'timeout') return 'retry';

  if (taken.status === 'not-a-file') return guardNotAFile(attempt.path);

  try {
    return await replaceUnderGuard({ attempt, candidate, guard: taken.guard });
  } finally {
    await releaseGuard(taken.guard);
  }
}

async function replaceUnderGuard(params: {
  attempt: Attempt;
  candidate: Candidate;
  guard: Guard;
}): Promise<Step> {
  const { attempt, candidate, guard } = params;
  const { path, uid } = attempt;
  const found = await lstatOrUndefined(path);

  if (found !== undefined) {
    if (!isOurSocket({ found, uid })) return notOurSocket(path);

    const verdict = await probeVerdict({ attempt, found });

    if (verdict !== undefined) return verdict;

    // The guarantee assumes the holder is not paused longer than the stale limit between this
    // check and the unlink: a guard stolen in that gap cannot be noticed any more.
    if (!(await holdsGuard(guard))) return 'retry';

    // Compares the socket's identity again at the unlink: the probe above may have taken a while.
    await unlinkIfSame({ path, identity: identityOf(found), uid });
  }

  return settle({
    attempt,
    candidate,
    publication: await publishCandidate({ candidate, path, uid }),
  });
}

/**
 * Drops the guard without letting a failure reach the caller: by now the lock is decided, and a
 * guard left behind is stolen once it is stale.
 */
async function releaseGuard(guard: Guard): Promise<string | undefined> {
  try {
    await dropGuard(guard);

    return undefined;
  } catch (caughtError) {
    return errorCode(caughtError);
  }
}

function acquired(params: {
  server: Server;
  path: string;
  identity: SocketIdentity | undefined;
  uid: number;
}): ServerLockResult {
  let released: Promise<string | undefined> | undefined;

  return {
    status: 'acquired',
    path: params.path,
    release: async () => {
      released ??= releaseSocket(params);
      await released;
    },
  };
}

function notOurSocket(path: string): ServerLockResult {
  return { status: 'unusable', path, reason: 'not-our-socket' };
}

function inconclusive(path: string): ServerLockResult {
  return { status: 'unusable', path, reason: 'probe-inconclusive' };
}

/** Something that is not a regular file sits at the guard path: no wait would ever end it. */
function guardNotAFile(path: string): ServerLockResult {
  return { status: 'unusable', path, reason: 'unexpected' };
}

function listenFailed(params: {
  attempt: Attempt;
  outcome: { code: string | undefined; error: unknown };
}): ServerLockResult {
  const { attempt, outcome } = params;

  return {
    status: 'unusable',
    path: attempt.path,
    reason: listenFailureReason(outcome.code),
    cause: outcome.error,
  };
}
