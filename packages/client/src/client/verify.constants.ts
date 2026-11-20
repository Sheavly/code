/**
 * The statuses that a server without the handshake route answers: not found, or a guard that wants
 * a token. Anything can answer them, so they are no proof of what the server is.
 */
export const NO_HANDSHAKE_STATUSES: readonly number[] = [401, 404];

/** How long `verifyServer` waits for the answer, head and body, unless `timeoutMs` says otherwise. */
export const VERIFY_TIMEOUT_MS = 5000;
