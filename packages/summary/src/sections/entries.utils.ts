/** Marks a cut-off entry, so a reader can tell it is not the whole text. */
const ELLIPSIS = '…';

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

/**
 * The previous entries followed by the new ones, without repeats (a repeated entry keeps its
 * newest place), then trimmed from the oldest end until the text fits in `maxChars`. An entry
 * too long to fit alone is cut and marked, so the newest thing said is never dropped whole.
 */
export function mergeEntries(params: {
  previous: string | undefined;
  added: readonly string[];
  maxChars: number;
}): string {
  const { previous, added, maxChars } = params;
  const all = [...entriesOf(previous), ...added.map(formatEntry)];
  const unique = all.filter((entry, index) => all.lastIndexOf(entry) === index);
  const kept: string[] = [];
  let size = 0;

  for (const entry of unique.reverse()) {
    const room = maxChars - size - (kept.length > 0 ? 1 : 0);

    if (entry.length <= room) {
      kept.unshift(entry);
      size += entry.length + (kept.length > 1 ? 1 : 0);
      continue;
    }

    // Only the newest entry is cut to fit; anything older that does not fit is dropped.
    if (kept.length === 0) kept.unshift(`${entry.slice(0, Math.max(0, room - 1))}${ELLIPSIS}`);
    break;
  }

  return kept.join('\n');
}
