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

/** The error code of a port that is taken (or that the OS has none left to give). */
export const ADDRESS_IN_USE = 'EADDRINUSE';
