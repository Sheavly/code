import { ANSI_SEQUENCE, CONTROL_CHARACTERS } from './printable.constants.js';

/**
 * `text` with its control characters and ANSI escape sequences removed, cut to `max` characters
 * (keeping the end, which is what tells two paths apart, behind a `…`). For text that came from
 * outside, such as a folder's name, before it goes to a log line or the wire: a terminal must not
 * run it and a line must not split.
 */
export function printable(params: { text: string; max: number }): string {
  const { text, max } = params;
  const clean = text.replace(ANSI_SEQUENCE, '').replace(CONTROL_CHARACTERS, '');

  if (clean.length <= max) return clean;

  // `max` bounds UTF-16 units (the wire's limit), so a cut that lands inside a surrogate pair drops
  // the pair's second half rather than leave it alone.
  const tail = clean.slice(clean.length - (max - 1));
  const kept = tail.isWellFormed() ? tail : tail.slice(1);

  return `…${kept}`;
}
