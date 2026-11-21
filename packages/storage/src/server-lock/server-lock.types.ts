import type { Server } from 'node:net';
import type { DirectoryProblem } from '../server-runtime/server-runtime.types.js';

/**
 * Why the lock could not be taken or checked. None of these may stop a server from starting.
 * `link-unsupported` is a folder whose file system refuses hard links (the lock needs one).
 */
export type LockUnusableReason =
  | DirectoryProblem
  | 'link-unsupported'
  | 'path-too-long'
  | 'not-our-socket'
  | 'probe-inconclusive'
  | 'retries-exhausted'
  | 'unexpected';

/**
 * What `acquireServerLock` found. Only `held` means another server owns this home; `unusable` is
 * a warning for the caller, who may still run.
 */
export type ServerLockResult =
  | {
      status: 'acquired';
      path: string;
      /** Idempotent, never throws, and safe to call from a signal handler. */
      release(): Promise<void>;
    }
  | { status: 'held'; path: string }
  | { status: 'unusable'; path?: string; reason: LockUnusableReason; cause?: unknown };

/** The options of `acquireServerLock`; those after `platform` exist so tests can shorten waits. */
export type AcquireServerLockParams = {
  /** The Sheavly home: its real path names the lock. */
  home: string;
  /** The private folder the socket is made in (`serverRuntimeDirectory`). Unused on Windows. */
  runtimeDir: string;
  platform?: NodeJS.Platform;
  now?: () => number;
  guardTimeoutMs?: number;
  guardStaleMs?: number;
  probeTimeoutMs?: number;
};

/** What one attempt to listen on the lock path gave: the server, or the error and its code. */
export type ListenOutcome =
  | { status: 'listening'; server: Server }
  | { status: 'failed'; code: string | undefined; error: unknown };

/**
 * A guard file this process created: its path, the nonce inside that proves it is ours, and the
 * inode and mtime it was created with, so a later look can tell it was stolen and replaced.
 */
export type Guard = { path: string; nonce: string; ino: number; mtimeMs: number };

/** What waiting for the guard gave. A guard path that is not a regular file is never waited for. */
export type GuardOutcome =
  { status: 'taken'; guard: Guard } | { status: 'timeout' } | { status: 'not-a-file' };

/** What tells one socket file from another that took its name: the inode and its birth time. */
export type SocketIdentity = { ino: number; birthtimeMs: number };

/** A server listening under a temporary name, waiting to be published at the lock path. */
export type Candidate = { server: Server; temporaryPath: string };

/** The result of publishing a listening server at the lock path. */
export type Publication =
  | { status: 'published'; identity: SocketIdentity }
  | { status: 'exists' }
  | { status: 'failed'; reason: LockUnusableReason; error: unknown };

/**
 * What `probeServerLock` found: `held` (a server listens), `free` (nobody does: what a killed
 * server leaves) or `inconclusive` (no answer in time, or an error that says neither).
 */
export type LockProbe = 'held' | 'free' | 'inconclusive';

/** What a connect to an existing socket file showed. */
export type ProbeResult = 'live' | 'stale' | 'unknown';
