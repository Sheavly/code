import { newNonce, verifyHandshakeProof } from '@sheavly/protocol/handshake/handshake.utils';
import { PROTOCOL_VERSION } from '@sheavly/protocol/version/protocol-version.constants';
import { checkProtocolVersion } from '@sheavly/protocol/version/version.utils';
import {
  AnswerError,
  AnswerTooLargeError,
  EmptyTokenError,
  RedirectedError,
  RefusedError,
  VerifyTimeoutError,
} from '../errors/client.errors.js';
import { createPublicClient } from './client.helper.js';
import type { AnswerOf } from './client.types.js';
import { NO_HANDSHAKE_STATUSES, VERIFY_TIMEOUT_MS } from './verify.constants.js';
import type { VerifyOptions, VerifyResult } from './verify.types.js';

/**
 * Whether the server at `url` is the instance that holds `token` and is `instanceId`, without the
 * token ever leaving this process: it asks the public `QUERY /handshake` with a fresh nonce and
 * checks the HMAC proof the server answers with.
 *
 * The proof is checked BEFORE the versions: a server that cannot prove it holds the token is
 * `wrong_server` and may not tell the client anything, least of all which side to update; the
 * "which side is older" message comes only from a server that holds the token.
 *
 * A server that is not there (connection refused, an abort) or that does not answer within
 * `timeoutMs` (5 s unless set; the caller's `signal` still aborts it sooner) is not a verdict about
 * any server, so an error is thrown, as every other call of this package does: the transport's
 * own, or `VerifyTimeoutError`; the caller decides whether that means "start one". What answers
 * but is not the server is `wrong_server`: a body past 4 KB, a redirect, an answer off the
 * contract or a bad proof. An empty token throws `EmptyTokenError` before any request. The token
 * is in no request, result or error.
 */
export async function verifyServer(options: VerifyOptions): Promise<VerifyResult> {
  // Before any request: a client with no token to prove against must not even ask.
  if (options.token === '') throw new EmptyTokenError();

  const nonce = newNonce();
  const answer = await askHandshake({ options, nonce });

  if (typeof answer === 'string') return { status: answer };

  const proven = await verifyHandshakeProof({
    token: options.token,
    nonce,
    instanceId: options.instanceId,
    protocolVersion: answer.protocolVersion,
    proof: answer.proof,
  });

  if (!proven) return { status: 'wrong_server' };

  const check = checkProtocolVersion({ client: PROTOCOL_VERSION, server: answer.protocolVersion });

  if (check.match) return { status: 'verified', protocolVersion: answer.protocolVersion };

  return {
    status: 'version_mismatch',
    older: check.older,
    client: check.client,
    server: check.server,
    message: check.message,
  };
}

/** Whether the failure is something that answered, but cannot be the server. */
function isNotTheServer(caughtError: unknown): boolean {
  return (
    caughtError instanceof AnswerError ||
    caughtError instanceof AnswerTooLargeError ||
    caughtError instanceof RedirectedError ||
    caughtError instanceof SyntaxError
  );
}

/**
 * The server's answer to the handshake, or the verdict its refusal or its shape already gives.
 * Anything that is a transport failure passes through.
 */
async function askHandshake(params: {
  options: VerifyOptions;
  nonce: string;
}): Promise<AnswerOf<'queryHandshake'> | 'wrong_server' | 'no_handshake'> {
  const { options, nonce } = params;
  const timeoutMs = options.timeoutMs ?? VERIFY_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(timeoutMs);
  // The public client holds no token: nothing here could send it.
  const client = createPublicClient({
    url: options.url,
    ...(options.fetch && { fetch: options.fetch }),
  });

  try {
    return await client.call('queryHandshake', {
      body: { nonce },
      signal: AbortSignal.any(options.signal ? [options.signal, timeout] : [timeout]),
    });
  } catch (caughtError) {
    if (caughtError instanceof RefusedError) {
      return NO_HANDSHAKE_STATUSES.includes(caughtError.status) ? 'no_handshake' : 'wrong_server';
    }

    // An answer off the contract, not JSON at all, too large to be one, or a redirect to
    // somewhere else: whatever answered is not a Sheavly server.
    if (isNotTheServer(caughtError)) return 'wrong_server';

    // Only the timer's own abort: the caller's abort stays the caller's, as the transport threw it.
    if (timeout.aborted && !options.signal?.aborted) {
      throw new VerifyTimeoutError({ timeoutMs, cause: caughtError });
    }

    throw caughtError;
  }
}
