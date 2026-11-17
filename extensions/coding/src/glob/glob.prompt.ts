import { MAX_GLOB_RESULTS, MAX_GLOB_SCANNED } from './glob.constants.js';

export const GLOB_PROMPTS = {
  description:
    'Find files by name pattern, newest first. pattern is a glob such as "*.ts" or ' +
    '"src/**/*.test.ts" (case-insensitive). Searches the whole workspace, or the folder in path ' +
    '(relative to the workspace root). Respects .gitignore; .env files and .git are never listed. ' +
    `At most ${MAX_GLOB_RESULTS} files are returned and the output says when more were cut, so ` +
    `narrow the pattern instead of repeating it. A pattern matching over ${MAX_GLOB_SCANNED} files ` +
    'is only sorted among the first ones found, so narrow it for a reliable newest-first.',
  pattern: 'Glob to match file paths against, e.g. "**/*.ts"',
  path: 'Folder to search, relative to the workspace root (default: all of it)',
} as const;

export function globTruncationPrompt(fileCount: number): string {
  return `Showing the newest of the files found, ${fileCount} in all; there are more. Narrow the pattern or path.`;
}
