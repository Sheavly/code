/**
 * Joins instruction sections into one text: each section trimmed, blank or missing ones dropped,
 * the rest separated by a blank line. It adds no guidance of its own, so an extension that
 * contributes instructions uses it to put its text in front of the app's.
 */
export function joinInstructions(sections: readonly (string | undefined)[]): string {
  return sections
    .map((section) => (section ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}
