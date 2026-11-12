/** The label an output reference is written with wherever the model reads one: `output_ref=<id>`. */
export const OUTPUT_REF_LABEL = 'output_ref=';

/** Bytes `read_output` returns when the model names no size, and the most it may ask for. */
export const DEFAULT_READ_BYTES = 16_384;
export const MAX_READ_BYTES = 65_536;

/** Matches `search_output` returns when the model names no count, and the most it may ask for. */
export const DEFAULT_MAX_MATCHES = 20;
export const MAX_MATCHES = 100;

/** The longest text `search_output` looks for, in characters. */
export const MAX_QUERY_CHARS = 1024;

/** Bytes of context kept on each side of a match. */
export const SNIPPET_BYTES = 160;

/** The most one search call scans before it hands back where to continue. */
export const MAX_SEARCH_SCAN_BYTES = 8 * 1024 * 1024;

/** How much of a log one search step holds in memory. */
export const SEARCH_WINDOW_BYTES = 256 * 1024;

/** The most one log keeps; output past it is dropped and the log says it is incomplete. */
export const MAX_LOG_BYTES = 128 * 1024 * 1024;

/**
 * The most one conversation's stored output may take, and the most logs it may hold. Past either, a
 * new command still runs but its full output is not stored, and its result says so.
 */
export const MAX_CONVERSATION_BYTES = 1024 * 1024 * 1024;
export const MAX_CONVERSATION_LOGS = 5_000;

/** How long closing a log waits for queued writes before it gives up and marks the log incomplete. */
export const OUTPUT_CLOSE_TIMEOUT_MS = 5_000;

/** The most one capture holds in memory waiting for the disk, before it gives up and says so. */
export const MAX_PENDING_BYTES = 8 * 1024 * 1024;
