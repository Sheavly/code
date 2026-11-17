/**
 * Automatic metadata commands in ask mode. Content readers and Git require an explicit grant:
 * their options can expose arbitrary files or run programs. Path-qualified executables never
 * inherit these automatic grants. Explicit user grants still cover the chosen base command.
 */
export const BUILT_IN_ALLOW = ['ls *', 'pwd', 'stat *'] as const;

/** Characters a shell gives a meaning this parser does not; each is refused outside quotes. */
export const REFUSED: Record<string, string> = {
  '<': 'redirects (< >)',
  '>': 'redirects (< >)',
  '(': 'subshells and parentheses',
  ')': 'subshells and parentheses',
  $: 'variables and substitution ($)',
  '`': 'backticks',
  '\n': 'newlines (join commands with ; && || or |)',
  '\r': 'newlines (join commands with ; && || or |)',
};

/** Ends the reason for a refused construct: what the parser can't carry out is refused. */
export const NOT_SUPPORTED = ' are not supported';
