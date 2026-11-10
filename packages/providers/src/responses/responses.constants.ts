/** A request may create at most this many cache writes, so at most this many breakpoints. */
export const MAX_CACHE_BREAKPOINTS = 4;

/** Explicit-only mode: nothing is written to the cache except at a breakpoint we mark. */
export const EXPLICIT_CACHE_OPTIONS = { mode: 'explicit' } as const;

/** The marker on a content block that ends a cacheable prefix. */
export const CACHE_BREAKPOINT = { mode: 'explicit' } as const;
