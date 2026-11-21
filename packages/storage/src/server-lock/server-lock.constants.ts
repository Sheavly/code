/** The longest socket path a system accepts is 108 bytes (`sun_path`); keep clear of that edge. */
export const LOCK_PATH_MAX_BYTES = 100;

/** How long a contender waits for the guard file before the attempt is given up. */
export const GUARD_DEADLINE_MS = 5000;

/**
 * A guard file older than this was left by a process that died holding it, and may be stolen. A
 * takeover is a few system calls and one probe, so this is well under the deadline: contenders
 * wait for the steal instead of timing out first.
 */
export const GUARD_STALE_MS = 2000;

/**
 * A socket that refuses connections but changed less than this long ago is not called stale: its
 * maker may be between `bind` and `listen`, or about to be.
 */
export const SOCKET_GRACE_MS = 250;

/**
 * The most bytes the temporary name adds to the lock path: `.<pid>.<nonce>` with a pid of up to
 * 7 digits (Linux's limit) and a 6-hex-digit nonce. Counted against the path limit.
 */
export const TEMP_NAME_EXTRA_BYTES = 15;

/** How long a connect to a socket file may take before the probe is called inconclusive. */
export const PROBE_TIMEOUT_MS = 1000;

/** How many times the lock is tried in all (listen, probe, take over) before it gives up. */
export const LOCK_ATTEMPTS = 3;

/** The suffix of the guard file kept beside the lock socket while a stale one is replaced. */
export const GUARD_SUFFIX = '.guard';

/** The suffix of the file a contender holds, beside the guard, while it removes an abandoned guard. */
export const BREAKER_SUFFIX = '.breaker';

/** The guard file is private to the user, like the folder it is in. */
export const GUARD_FILE_MODE = 0o600;

/** The wait between looks at a held guard: a fixed part plus up to the jitter, so contenders spread. */
export const GUARD_POLL_MS = 5;
export const GUARD_POLL_JITTER_MS = 15;

/** The errors a listen gives when the folder cannot be written to. */
export const UNWRITABLE_CODES: readonly string[] = [
  'EACCES',
  'EPERM',
  'EROFS',
  'ENOENT',
  'ENOTDIR',
];

/** The errors a hard link gives when the file system or the folder refuses links. */
export const LINK_UNSUPPORTED_CODES: readonly string[] = [
  'EPERM',
  'EOPNOTSUPP',
  'ENOTSUP',
  'EXDEV',
  'EMLINK',
];

/** The errors a connect gives to a socket file nobody listens on. */
export const STALE_PROBE_CODES: readonly string[] = ['ECONNREFUSED', 'ENOENT'];
