/**
 * Stops written text from carrying an envelope's tags or a section header of its own. Every `<`
 * is swapped, not just the envelope's spelling, because a model reads many spellings of a tag
 * (spaces, attributes, lookalike characters) and a list of them is never complete; `#` at a line
 * start is escaped so a body cannot start another section. For text a model or a tool wrote and
 * the harness inserts as data inside a fixed envelope.
 */
export function neutralize(text: string): string {
  return escapeTags(text).replaceAll(/^([ \t]*)#/gm, '$1\\#');
}

/**
 * Swaps every `<` so written text cannot close or open an envelope, and changes nothing else. For
 * text that must reach the model whole, such as a sub-agent's report, where a heading is content.
 */
export function escapeTags(text: string): string {
  return text.replaceAll(/[<＜﹤〈❮]/g, '‹');
}

/**
 * A run of dashes longer than any run in `body`, at least three. A fence line built from it
 * (`--- report ---`) cannot appear inside `body`, so text between two such lines cannot end the
 * block early and write what follows as if the harness had.
 */
export function fenceDashes(body: string): string {
  let longest = 0;

  // A loop, not Math.max(...runs): a spread throws a RangeError on a body with very many runs.
  for (const [run] of body.matchAll(/-+/g)) longest = Math.max(longest, run.length);

  return '-'.repeat(Math.max(3, longest + 1));
}

/** A title is one line, so it cannot open a section of its own. */
export function oneLine(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}
