/**
 * The private SGR codes that carry a mark through Ink, which drops every escape sequence but
 * styling and hyperlinks. They are replaced by the real sequences on the way to the terminal
 * (`restoringMarks`), and a terminal that ever got one would ignore it as an unknown parameter.
 */
export const MARK_CARRIERS = {
  prompt: 9701,
  output: 9702,
  done: 9703,
  failed: 9704,
} as const;
