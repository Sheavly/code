import type { InstanceId } from '@sheavly/protocol/handshake/handshake.types';

/** What `verifyServer` needs: where the server is, and what a server that holds the token knows. */
export type VerifyOptions = {
  url: string;
  /** Used only to check the server's proof; never sent. */
  token: string;
  /** The instance id the client expects: parsed with `instanceIdSchema` where it was read. */
  instanceId: InstanceId;
  /** Reaches the server (the global `fetch` when unset): a test's fake. */
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /**
   * How long to wait for the answer, head and body (`VERIFY_TIMEOUT_MS`, 5 s, when unset): a
   * server that does not answer in time makes `verifyServer` throw `VerifyTimeoutError`.
   */
  timeoutMs?: number;
};

/**
 * What a server turned out to be. Only `verified` and `version_mismatch` come from a server that
 * proved it holds the token, so only they may lead to sending it; `no_handshake` and
 * `wrong_server` never do.
 *
 * - `verified`: the server proved it, and speaks a protocol this client can.
 * - `version_mismatch`: the server proved it, and speaks a protocol this client can't, with `older`
 *   saying which side to update.
 * - `wrong_server`: not the instance that holds this token (or not a Sheavly server at all).
 * - `no_handshake`: the route answered 401 or 404: a server without the route, or something that
 *   is not Sheavly. It is not a verdict that the server is Sheavly: nginx, another app or an
 *   impostor answers 404 too, and an impostor chooses to.
 */
export type VerifyResult =
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
