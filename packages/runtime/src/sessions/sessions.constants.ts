/** Sessions nest at most this deep: main session → sub-agent → sub-agent. A hard cap. */
export const MAX_SESSION_DEPTH = 3;

/**
 * How many of the newest entries a store-backed log keeps in memory: enough for a UI that
 * reconnects from its last event id to catch up without reading the disk. Older ones are read
 * from the store.
 */
export const ENTRY_TAIL_SIZE = 1000;
