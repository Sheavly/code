/** A lock file older than this is taken for a crashed holder's, even if its process id is reused. */
export const LOCK_STALE_MS = 30_000;

/** How long a change waits for another process's lock before it fails, naming the lock file. */
export const LOCK_WAIT_MS = 10_000;

/** How long to wait between looks at a held lock. */
export const LOCK_POLL_MS = 15;

/** The suffix of the lock file kept beside what it guards. */
export const LOCK_SUFFIX = '.lock';
