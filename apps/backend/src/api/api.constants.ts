/** A comment line sent while a stream is quiet, so a proxy in between never closes it as idle. */
export const HEARTBEAT_MS = 15_000;

/** The largest request body the server reads: a prompt or saved history, never a file upload. */
export const MAX_BODY_BYTES = 5_000_000;
