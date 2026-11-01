import { countOccurrences } from '../files/files.utils.js';

/**
 * Applies an edit to `before`, or throws a message telling the model how to fix the call:
 * `oldText` must occur exactly once, unless `replaceAll` is set.
 */
export function applyEdit(params: {
  before: string;
  oldText: string;
  newText: string;
  replaceAll: boolean;
  requested: string;
}): { after: string; count: number } {
  const { before, oldText, newText, replaceAll, requested } = params;

  if (oldText === newText) {
    throw new Error('oldText and newText are the same: nothing to change.');
  }

  const count = countOccurrences({ text: before, search: oldText });

  if (count === 0) {
    throw new Error(
      `oldText was not found in ${requested}. Read the file and copy the text exactly.`,
    );
  }

  if (count > 1 && !replaceAll) {
    throw new Error(
      `oldText occurs ${count} times in ${requested}. Add surrounding lines to make it unique, or set replaceAll.`,
    );
  }

  // A function replacer, so `$&` and friends in newText are inserted literally.
  const after = replaceAll
    ? before.replaceAll(oldText, () => newText)
    : before.replace(oldText, () => newText);

  return { after, count };
}
