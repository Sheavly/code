/** The byte that ends a line of a JSON Lines file. */
export const NEWLINE = 0x0a;

/**
 * The longest line, in characters, `readJsonLines` reads by default. A file with a longer stretch
 * and no newline (damaged, or planted) is refused instead of being held in memory whole. Well
 * above any entry the harness writes: tool output and pasted text are bounded long before this.
 */
export const MAX_LINE_CHARS = 32 * 1024 * 1024;
