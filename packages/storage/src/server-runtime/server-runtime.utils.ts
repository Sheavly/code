import { createHash } from 'node:crypto';
import path from 'node:path';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';
import {
  MAX_PROCESS_ID,
  SERVER_HASH_LENGTH,
  SOCKET_SUFFIX,
  WINDOWS_PIPE_PREFIX,
} from './server-runtime.constants.js';

/**
 * Whether a process with this pid exists. A pid that is not an integer in 1..4194304 is never a
 * process (signal 0 to pid 0 would go to the whole process group); `EPERM` means it exists but is
 * not ours to signal. A pid can be reused, so `true` is only "something runs under it".
 */
export function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 1 || pid > MAX_PROCESS_ID) return false;

  try {
    process.kill(pid, 0);

    return true;
  } catch (caughtError) {
    return errorCode(caughtError) !== 'ESRCH';
  }
}

/** The name of one home's server: the first hex characters of the sha256 of its resolved path. */
export function hashResolvedHome(resolvedHome: string): string {
  return createHash('sha256').update(resolvedHome).digest('hex').slice(0, SERVER_HASH_LENGTH);
}

/**
 * Where the lock for `hash` lives: a socket file inside `runtimeDir`, or on Windows a named pipe
 * (no folder is used there).
 */
export function serverEndpoint(params: {
  platform: NodeJS.Platform;
  runtimeDir: string;
  hash: string;
}): string {
  const { platform, runtimeDir, hash } = params;

  if (platform === 'win32') return `${WINDOWS_PIPE_PREFIX}${hash}`;

  return path.join(runtimeDir, `${hash}${SOCKET_SUFFIX}`);
}

/**
 * How many bytes the socket path under `runtimeDir` takes, known before the hash is: the hash
 * always has the same length. Lets a too-long path be refused before any file system call.
 */
export function socketPathBytes(runtimeDir: string): number {
  return Buffer.byteLength(
    serverEndpoint({
      platform: 'linux',
      runtimeDir,
      hash: '0'.repeat(SERVER_HASH_LENGTH),
    }),
  );
}
