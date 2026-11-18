/** Sessions nest at most this deep: main session → sub-agent → sub-agent. A hard cap. */
export const MAX_SESSION_DEPTH = 3;

/**
 * How many extension notices one session's outbox holds before the loop drains it at its next
 * turn. An idle session keeps them for its next prompt, so without a cap an extension could grow
 * it without bound; past it, `queueNotice` throws.
 */
export const MAX_QUEUED_NOTICES = 100;

/**
 * How many of the newest entries a log keeps in memory: enough for a UI that reconnects from its
 * last event id to catch up without reading the disk. Older ones are read from the store, or
 * gone when there is none.
 */
export const ENTRY_TAIL_SIZE = 1000;
