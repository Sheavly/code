/**
 * Where `SERVER_PORT=0` falls back to when the OS has no free ephemeral port. The range lies below
 * every common OS's ephemeral range (Linux 32768-60999, macOS, Windows and BSD 49152-65535), so a
 * machine whose ephemeral ports are used up still has these free.
 */
export const FALLBACK_PORT_MIN = 20_000;

/** The highest fallback port (inclusive); see `FALLBACK_PORT_MIN`. */
export const FALLBACK_PORT_MAX = 32_000;

/** How many random fallback ports are tried before giving up. */
export const FALLBACK_PORT_ATTEMPTS = 20;

/**
 * How long a client has to send a whole request, head and body (Node's default is 300 s). A public
 * route reads a body with no token, so a connection that trickles one is unauthenticated work.
 * It covers receiving the request only: a response, such as a server-sent event stream, is not
 * bound by it.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/** How long a client has to send the request's headers (Node's default is 60 s). */
export const HEADERS_TIMEOUT_MS = 10_000;

/** How often Node looks for connections past those two limits (its default is 30 s). */
export const CONNECTIONS_CHECK_INTERVAL_MS = 1000;

/** The error code of a port that is taken (or that the OS has none left to give). */
export const ADDRESS_IN_USE = 'EADDRINUSE';
