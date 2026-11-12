import { ELLIPSIS } from './sections.constants.js';

/**
 * A rules section is a list of entries, each starting a line with `- `. A longer entry continues
 * on lines indented by two spaces, so an entry's own text can never be taken for the next entry.
 */
export function formatEntry(text: string): string {
  const [first = '', ...rest] = text.trim().split('\n');

  return [`- ${first}`, ...rest.map((line) => `  ${line}`)].join('\n');
}

/** The entries of a section's text, oldest first: the inverse of joining `formatEntry` results. */
export function entriesOf(text: string | undefined): string[] {
  if (!text) return [];

  return text.split(/\n(?=- )/).filter((entry) => entry.startsWith('- '));
}

/** `entry` cut so it fits in `room` characters, marked, when it does not fit whole. */
function fitted(params: { entry: string; room: number }): string {
  const { entry, room } = params;

  return entry.length <= room ? entry : `${entry.slice(0, Math.max(0, room - 1))}${ELLIPSIS}`;
}

/**
 * The previous entries followed by the new ones, without repeats (a repeated entry keeps its
 * newest place), then trimmed until the text fits in `maxChars`: from the oldest end, except that
 * the first `pin` entries are kept and the ones after them go instead. An entry too long to fit
 * alone is cut and marked, so the newest thing said (or the pinned one) is never dropped whole.
 */
export function mergeEntries(params: {
  previous: string | undefined;
  added: readonly string[];
  maxChars: number;
  /** How many of the oldest entries are never dropped for room. Default none. */
  pin?: number;
}): string {
  const { previous, added, maxChars, pin = 0 } = params;
  const all = [...entriesOf(previous), ...added.map(formatEntry)];
  const head = all.slice(0, pin).filter((entry, index, list) => list.indexOf(entry) === index);
  const rest = all
    .slice(pin)
    .filter((entry, index, list) => list.lastIndexOf(entry) === index && !head.includes(entry));
  const kept: string[] = [];
  let size = 0;

  for (const entry of head) {
    const room = maxChars - size - (kept.length > 0 ? 1 : 0);

    kept.push(fitted({ entry, room }));
    size += kept.at(-1)?.length ?? 0;

    if (entry.length > room) return kept.join('\n');
  }

  const tail: string[] = [];

  for (const entry of rest.reverse()) {
    const room = maxChars - size - (kept.length + tail.length > 0 ? 1 : 0);

    if (entry.length <= room) {
      tail.unshift(entry);
      size += entry.length + (kept.length + tail.length > 1 ? 1 : 0);
      continue;
    }

    // Only the newest entry is cut to fit, and only when nothing is kept yet; anything older that
    // does not fit is dropped.
    if (kept.length + tail.length === 0) tail.unshift(fitted({ entry, room }));
    break;
  }

  return [...kept, ...tail].join('\n');
}
