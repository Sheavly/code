import type { FileProblem, ListedFile } from './listing.types.js';

const collator = new Intl.Collator('en');

/**
 * The items ordered by name, then id. The locale is fixed, not the system's, so a folder lists the
 * same on every machine; two items with one name (allowed: it is only a label) keep a stable order
 * by their ids. Returns a new array.
 */
export function sortByName<T extends { id: string; name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const byName = collator.compare(a.name, b.name);

    if (byName !== 0) return byName;

    return a.id < b.id ? -1 : Number(a.id > b.id);
  });
}

/**
 * Splits what a folder's files read as into the items that read cleanly and a problem for each
 * that did not, so one bad file never hides the rest.
 */
export function splitListed<T>(listed: readonly ListedFile<T>[]): {
  items: T[];
  problems: FileProblem[];
} {
  return {
    items: listed.flatMap((file) => (file && 'item' in file ? [file.item] : [])),
    problems: listed.flatMap((file) => (file && 'problem' in file ? [file.problem] : [])),
  };
}
