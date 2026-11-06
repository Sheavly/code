/**
 * Automatic metadata commands in ask mode. Content readers and Git require an explicit grant:
 * their options can expose arbitrary files or run programs. Path-qualified executables never
 * inherit these automatic grants. Explicit user grants still cover the chosen base command.
 */
export const BUILT_IN_ALLOW = ['ls *', 'pwd', 'stat *'] as const;
