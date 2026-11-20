import type { Stats } from 'node:fs';
import type { Server } from 'node:net';
import { link, lstat, unlink } from 'node:fs/promises';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';
import type { Candidate, Publication, SocketIdentity } from './server-lock.types.js';
import { hasIdentity, identityOf, isOurSocket, linkFailureReason } from './server-lock.utils.js';

/**
 * Makes the candidate's socket appear at `path` with a hard link, which is atomic and fails with
 * `EEXIST` when the name is taken: the lock path never names a socket that is not yet listening,
 * and never replaces one. On success the temporary name is removed (the socket now lives under
 * `path`) and the identity of the published file is returned. If a step after the link throws,
 * the lock path is removed again when it is still this socket, and the error is rethrown; the
 * caller closes the server and removes the temporary name.
 */
export async function publishCandidate(params: {
  candidate: Candidate;
  path: string;
  uid: number;
}): Promise<Publication> {
  const { candidate, path, uid } = params;
  // Taken before the link, from the temporary name that is ours alone: a failure after the link
  // then still knows which file to take down.
  const identity = identityOf(await lstat(candidate.temporaryPath));

  try {
    await link(candidate.temporaryPath, path);
  } catch (caughtError) {
    const code = errorCode(caughtError);

    return code === 'EEXIST'
      ? { status: 'exists' }
      : { status: 'failed', reason: linkFailureReason(code), error: caughtError };
  }

  try {
    await unlinkQuietly(candidate.temporaryPath);
  } catch (caughtError) {
    await takeDownPublished({ path, identity, uid, failure: caughtError });

    throw caughtError;
  }

  return { status: 'published', identity };
}

/** Removes the lock path again after a failed publish; if that fails too, both errors are thrown. */
async function takeDownPublished(params: {
  path: string;
  identity: SocketIdentity;
  uid: number;
  failure: unknown;
}): Promise<void> {
  const { path, identity, uid, failure } = params;

  try {
    await unlinkIfSame({ path, identity, uid });
  } catch (caughtError) {
    throw new AggregateError([failure, caughtError], 'the lock path could not be taken down', {
      cause: caughtError,
    });
  }
}

/**
 * Closes a candidate that did not become the lock. Never rejects; the code of a failed unlink of
 * the temporary name is returned, since nothing on this path can act on it.
 */
export async function discardCandidate(candidate: Candidate): Promise<string | undefined> {
  await closeServer(candidate.server);

  try {
    await unlinkQuietly(candidate.temporaryPath);

    return undefined;
  } catch (caughtError) {
    return errorCode(caughtError);
  }
}

/**
 * Removes the lock socket only if it is still the file this server published, then closes the
 * server. The name goes first, while the server still listens, so no refusing socket is ever seen
 * at the lock path. Never rejects: it runs on the way out, where nothing can act on a failed
 * unlink, so the failure's code is all it returns.
 */
export async function releaseSocket(params: {
  server: Server;
  path: string;
  identity: SocketIdentity | undefined;
  uid: number;
}): Promise<string | undefined> {
  const { server, path, identity, uid } = params;
  let failure: string | undefined;

  if (identity !== undefined) {
    try {
      await unlinkIfSame({ path, identity, uid });
    } catch (caughtError) {
      failure = errorCode(caughtError);
    }
  }

  await closeServer(server);

  return failure;
}

/** Removes `path` only if it is a socket of `uid` with this identity; a file that is gone is fine. */
export async function unlinkIfSame(params: {
  path: string;
  identity: SocketIdentity;
  uid: number;
}): Promise<void> {
  const { path, identity, uid } = params;
  const found = await lstatOrUndefined(path);

  if (found === undefined || !isOurSocket({ found, uid })) return;

  if (!hasIdentity({ found, identity })) return;

  await unlinkQuietly(path);
}

export async function lstatOrUndefined(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (caughtError) {
    if (errorCode(caughtError) === 'ENOENT') return undefined;

    throw caughtError;
  }
}

async function unlinkQuietly(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (caughtError) {
    if (errorCode(caughtError) !== 'ENOENT') throw caughtError;
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}
