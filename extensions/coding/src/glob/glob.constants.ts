/** Most files returned per call; the rest is reported as cut. */
export const MAX_GLOB_RESULTS = 200;

/**
 * Most matching files looked at (one stat each) to find the newest. A pattern that matches more
 * is cut, and the newest is then only the newest of the first ones by path.
 */
export const MAX_GLOB_SCANNED = 5_000;

/** How many files are stat-ed at once. */
export const GLOB_STAT_BATCH = 64;
