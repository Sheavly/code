/** Results a search returns when the agent names no limit. */
export const DEFAULT_SEARCH_LIMIT = 10;

/** The most results one search returns, however many are asked for. */
export const MAX_SEARCH_LIMIT = 25;

/**
 * The most entries one search call examines, however few match. A call that reaches it stops and
 * returns a cursor to carry on from, so the work of a call is bounded even on a very long log.
 */
export const MAX_SCAN_ENTRIES = 2_000;

/** The longest search text and cursor accepted: far past anything a real search or cursor needs. */
export const MAX_QUERY_CHARS = 500;
export const MAX_CURSOR_CHARS = 2_000;

/** Characters of context shown around a match in a search result. */
export const EXCERPT_CHARS = 300;

/** Characters of one entry `read_history_entry` returns before it says it cut the rest. */
export const MAX_ENTRY_CHARS = 8_000;
