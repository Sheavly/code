/** Most lines returned per call; the model asks for the rest with `startLine`. */
export const MAX_READ_LINES = 1000;

/** Backstop for files with very long lines: the most characters returned per call. */
export const MAX_READ_CHARS = 100_000;
