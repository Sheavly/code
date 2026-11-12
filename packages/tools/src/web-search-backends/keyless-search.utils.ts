/**
 * Wikipedia marks matches with HTML spans and escapes entities; the model gets plain text.
 * The tag pattern excludes `<` so a run of them without `>` is scanned once, not quadratically.
 */
export function cleanWikipediaSnippet(snippet: string) {
  return snippet
    .replace(/<[^<>]*>/g, '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}
