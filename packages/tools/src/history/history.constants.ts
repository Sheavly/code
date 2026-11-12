/** Results a search returns when the agent names no limit. */
export const DEFAULT_SEARCH_LIMIT = 10;

/** The most results one search returns, however many are asked for. */
export const MAX_SEARCH_LIMIT = 25;

/**
 * The most entries one search call examines, however few match. A call that reaches it stops and
 * returns a cursor to carry on from, so the work of a call is bounded even on a very long log.
 */
export const MAX_SCAN_ENTRIES = 2_000;

/** Characters of context shown around a match in a search result. */
export const EXCERPT_CHARS = 300;

/** Characters of one entry `read_history_entry` returns before it says it cut the rest. */
export const MAX_ENTRY_CHARS = 8_000;

/** Separates a session id from an entry's `seq` in a cursor. */
export const CURSOR_SEPARATOR = '#';
