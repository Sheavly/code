/** Chunks kept per agent and file; the oldest go first (a read of the whole file is never dropped). */
export const MAX_CHUNKS_PER_FILE = 64;

/** Files whose reads are kept with a conversation; the ones touched longest ago go first. */
export const MAX_PERSISTED_FILES = 200;

/**
 * Characters of file text kept with a conversation, over all its files. A view that would pass it
 * is left out (the file is simply read again), so `shell.json` stays small and a prompt that ends
 * does not rewrite megabytes.
 */
export const MAX_PERSISTED_CHARS = 2_000_000;

/** A hash is a sha-256 hex digest; anything longer in a stored document is not one. */
export const MAX_HASH_LENGTH = 128;

/** The key of the main agent's reads in a conversation's `shell.json`. */
export const FILE_READS_KEY = 'fileReads';
