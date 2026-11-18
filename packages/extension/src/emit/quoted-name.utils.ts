import { MAX_QUOTED_EMITTED_CHARS } from './emit.constants.js';

/**
 * A caller's kind or topic as a short JSON string literal, so a newline or an escape sequence
 * cannot reach a log. A non-string (plain-JS callers) is named by its type, never printed.
 */
export function quotedName(emitted: unknown): string {
  const text = typeof emitted === 'string' ? emitted : `(${typeof emitted})`;
  const short =
    text.length > MAX_QUOTED_EMITTED_CHARS ? `${text.slice(0, MAX_QUOTED_EMITTED_CHARS)}...` : text;

  return JSON.stringify(short);
}
