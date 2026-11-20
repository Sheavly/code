import type { Stats } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  GUARD_SUFFIX,
  LINK_UNSUPPORTED_CODES,
  STALE_PROBE_CODES,
  UNWRITABLE_CODES,
} from './server-lock.constants.js';
import type { LockUnusableReason, ProbeResult, SocketIdentity } from './server-lock.types.js';

/**
 * A name nobody else uses, beside the lock socket, for a server to listen under until it is
 * published. At most `TEMP_NAME_EXTRA_BYTES` longer than `socketPath`.
 */
export function temporarySocketPath(socketPath: string): string {
  return `${socketPath}.${String(process.pid)}.${randomBytes(3).toString('hex')}`;
}

/** The inode and birth time of a socket file. Unlike `ctime`, a hard link or unlink leaves them. */
export function identityOf(found: Stats): SocketIdentity {
  return { ino: found.ino, birthtimeMs: found.birthtimeMs };
}

/** Whether `found` is the very file `identity` was taken from, not a later one with a reused inode. */
export function hasIdentity(params: { found: Stats; identity: SocketIdentity }): boolean {
  const { found, identity } = params;

  return found.ino === identity.ino && found.birthtimeMs === identity.birthtimeMs;
}

/** The guard file that serializes replacing a stale socket at `socketPath`. */
export function guardPath(socketPath: string): string {
  return `${socketPath}${GUARD_SUFFIX}`;
}

/** Only a socket file owned by this user may ever be removed as stale. */
export function isOurSocket(params: { found: Stats; uid: number }): boolean {
  return params.found.isSocket() && params.found.uid === params.uid;
}

/**
 * What a connect error says about the socket file: refused or gone means nobody listens. Any
 * other error is unknown, never guessed to be stale: removing a live server's socket would let
 * a second server start.
 */
export function probeResultOfError(code: string | undefined): ProbeResult {
  return code !== undefined && STALE_PROBE_CODES.includes(code) ? 'stale' : 'unknown';
}

/** The reason a failed listen is reported with. */
export function listenFailureReason(code: string | undefined): LockUnusableReason {
  return code !== undefined && UNWRITABLE_CODES.includes(code) ? 'dir-unwritable' : 'unexpected';
}

/** The reason a failed hard link is reported with: a refused link is not an unwritable folder. */
export function linkFailureReason(code: string | undefined): LockUnusableReason {
  if (code !== undefined && LINK_UNSUPPORTED_CODES.includes(code)) return 'link-unsupported';

  return listenFailureReason(code);
}

/**
 * The pid in a temporary name of the lock socket `socketName` (`<socketName>.<pid>.<6 hex>`), or
 * undefined for any other name.
 */
export function temporaryNamePid(params: { name: string; socketName: string }): number | undefined {
  const { name, socketName } = params;

  if (!name.startsWith(`${socketName}.`)) return undefined;

  const match = /^(\d+)\.[0-9a-f]{6}$/.exec(name.slice(socketName.length + 1));

  return match?.[1] === undefined ? undefined : Number(match[1]);
}
