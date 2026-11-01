/** A command split into words, or why it can't be. */
export type ParseResult = { ok: true; argv: string[] } | { ok: false; reason: string };
