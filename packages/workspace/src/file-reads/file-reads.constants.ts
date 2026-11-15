/** Chunks kept per agent and file; the oldest go first (a read of the whole file is never dropped). */
export const MAX_CHUNKS_PER_FILE = 64;

/** Files whose reads are kept with a conversation; the ones read first go first. */
export const MAX_PERSISTED_FILES = 200;

/** The key of the main agent's reads in a conversation's `shell.json`. */
export const FILE_READS_KEY = 'fileReads';
