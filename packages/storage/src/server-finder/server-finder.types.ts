import type { InstanceId } from '@sheavly/protocol/handshake/handshake.types';
import type { DirectoryDetail } from '../server-runtime/server-runtime.types.js';
import type { ReadRefusal } from '../discovery-file/discovery-file.types.js';

/** What the injected handshake is given: where the server is and what only the real one knows. */
export type FinderVerifyParams = {
  url: string;
  /** Used only to check the server's proof; the handshake never sends it. */
  token: string;
  instanceId: InstanceId;
  timeoutMs?: number;
  /** Aborted when the finder stops waiting for the handshake; the handshake should stop too. */
  signal?: AbortSignal;
};

/**
 * What the injected handshake answers, the same shape as the client's `VerifyResult` (a test in
 * the backend fails if they drift). Only `verified` and `version_mismatch` come from a server
 * that proved it holds the token.
 */
export type FinderVerifyResult =
  | { status: 'verified'; protocolVersion: string }
  | {
      status: 'version_mismatch';
      older: 'client' | 'server';
      client: string;
      server: string;
      message: string;
    }
  | { status: 'wrong_server' }
  | { status: 'no_handshake' };

/** The handshake `findRunningServer` calls; it may throw (a timeout, a network error). */
export type FinderVerify = (params: FinderVerifyParams) => Promise<FinderVerifyResult>;

/** The problems a folder can have that need nothing beyond the folder to describe. */
export type SimpleProblem =
  | 'no-file'
  | 'invalid'
  | 'newer-format'
  | 'stale'
  | 'lock-inconclusive'
  | 'wrong-server'
  | 'no-handshake'
  | 'no-answer';

/** Why a folder did not give a server. Each carries the folder and a message with no secret. */
export type Reason = { directory: string; message: string } & (
  | { problem: 'refused'; refusal: ReadRefusal['reason']; detail?: DirectoryDetail }
  | { problem: SimpleProblem }
);

/** The parameters of `findRunningServer`. */
export type FindRunningServerParams = {
  /** The Sheavly home whose server is looked for. */
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  /** The user the folders and the file must belong to; ignored on Windows. */
  uid: number;
  platform?: NodeJS.Platform;
  verify: FinderVerify;
  /** Gets one line per folder that gave no server; never the token. */
  log?: (line: string) => void;
  /** Passed to the lock probe and to the handshake. */
  timeoutMs?: number;
};

/**
 * What `findRunningServer` found. Only `found` carries the token, and only after the handshake
 * proved the server holds it. `version_mismatch` is a server that proved it and speaks another
 * protocol, with no token: `older` says which side to update.
 */
export type FoundServer =
  | {
      status: 'found';
      url: string;
      token: string;
      instanceId: InstanceId;
      pid: number;
      serverVersion: string;
      protocolVersion: string;
    }
  | {
      status: 'version_mismatch';
      older: 'client' | 'server';
      client: string;
      server: string;
      message: string;
    }
  | { status: 'none'; reasons: Reason[] };
