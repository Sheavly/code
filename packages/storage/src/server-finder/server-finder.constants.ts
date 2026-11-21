/** How long the finder waits for one handshake unless `timeoutMs` says otherwise, as `verifyServer` does. */
export const HANDSHAKE_TIMEOUT_MS = 5000;

/** The most characters a text from the handshake may have: a command prints it. */
export const MAX_VERDICT_TEXT_LENGTH = 200;

/** Control and format characters (escapes, bidi, zero-width) and the line and paragraph separators. */
export const UNPRINTABLE_TEXT = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

/** What a message says of a failure whose name may not be shown. */
export const UNKNOWN_FAILURE = 'an unknown failure';

/** The failure names a message or log line may carry; any other name could be a secret. */
export const NAMEABLE_FAILURES: readonly string[] = [
  'VerifyTimeoutError',
  'EmptyTokenError',
  'TypeError',
  'Error',
  'AbortError',
  'TimeoutError',
  'RangeError',
];
