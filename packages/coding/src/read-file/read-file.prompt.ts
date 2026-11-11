import { MAX_READ_LINES } from './read-file.constants.js';

export const READ_FILE_PROMPTS = {
  description:
    'Read a UTF-8 text file. Paths are relative to the workspace root. ' +
    `Returns at most ${MAX_READ_LINES} lines per call; use startLine and endLine (1-based, inclusive) ` +
    'to read a range. When a file is cut, a note at the end says which lines were shown and where to continue. ' +
    'Files outside the workspace and .env files cannot be read.',
  path: 'File path, relative to the workspace root',
  startLine: 'First line to read, 1-based (default 1)',
  endLine: `Last line to read, inclusive (default: ${MAX_READ_LINES} lines from startLine)`,
};

export function pastEndPrompt(params: { total: number; start: number }): string {
  const { total, start } = params;

  return `[The file has ${total} lines; startLine ${start} is past the end, so there is nothing to show. Use startLine 1–${total}.]`;
}

/** Receives the already selected range and factual adjustment notes, not file content. */
export function shownLinesPrompt(params: {
  start: number;
  end: number;
  total: number;
  notes: string[];
  reachedEnd: boolean;
  tool: string;
}): string {
  const { start, end, total, notes, reachedEnd, tool } = params;
  const next = reachedEnd
    ? 'That is the end of the file.'
    : `To read on, call ${tool} with startLine ${end + 1}.`;

  return `[Showing lines ${start}–${end} of ${total}. ${[...notes, next].join(' ')}]`;
}
