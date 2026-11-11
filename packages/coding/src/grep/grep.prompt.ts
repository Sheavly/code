import { MAX_GREP_RESULTS } from './grep.constants.js';

export const GREP_PROMPTS = {
  description:
    'Search file contents with ripgrep (a regular expression). Searches the whole workspace, or ' +
    'the file or folder in path (relative to the workspace root). Respects .gitignore; .env files ' +
    'and .git are never searched. mode content (default) returns path:line:text, files only the ' +
    'paths that match, count the number of matching lines per file. glob limits which files are ' +
    `searched, e.g. "*.ts", and ignores case. At most ${MAX_GREP_RESULTS} results are returned and the output says ` +
    'when more were cut, so narrow the search instead of repeating it.',
  pattern: 'Regular expression to search for (Rust regex syntax)',
  path: 'File or folder to search, relative to the workspace root (default: all of it)',
  glob: 'Only search files matching this glob, e.g. "*.ts"',
  mode: 'What to return (default content)',
  caseInsensitive: 'Ignore case (default: case-sensitive)',
} as const;

export function grepTruncationPrompt(resultCount: number): string {
  return `Showing the first ${resultCount} results; there are more. Narrow the search with path or glob, or a more specific pattern.`;
}
