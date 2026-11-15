import { createReadStream } from 'node:fs';
import { newTextHash } from '@sheavly/workspace/file-reads/file-reads.utils';
import type { StreamedLines } from './read-file.types.js';
import { firstLine } from './read-file.utils.js';

/**
 * Reads `file` once, as a stream, so a large file never sits in memory: it hashes all of the text,
 * counts every line and keeps only the window a read can show. A line is kept up to `maxChars + 1`
 * characters, enough for the character cap to decide where to cut, however long the line is. The
 * stream decodes UTF-8 itself, so a character split across two chunks is not broken. Rejects with
 * the abort reason when `signal` aborts, and with the file system's error otherwise.
 */
export async function streamLines(params: {
  file: string;
  startLine: number | undefined;
  maxLines: number;
  maxChars: number;
  signal: AbortSignal;
}): Promise<StreamedLines> {
  const { file, startLine, maxLines, maxChars, signal } = params;
  const first = firstLine(startLine);
  const hash = newTextHash();
  const window: string[] = [];
  let total = 0;
  let current = '';
  let endsWithNewline = false;

  /** Counts a finished line, and keeps it when it falls in the window. */
  const finishLine = () => {
    total += 1;
    if (total >= first && window.length < maxLines) window.push(current.slice(0, maxChars + 1));
    current = '';
  };

  for await (const chunk of createReadStream(file, { encoding: 'utf8', signal })) {
    const text = chunk as string;

    hash.update(text);
    endsWithNewline = text.endsWith('\n');

    const pieces = text.split('\n');
    const last = pieces.pop() ?? '';

    for (const [index, piece] of pieces.entries()) {
      current = keepStart({ line: index === 0 ? current + piece : piece, maxChars });
      finishLine();
    }

    current = keepStart({ line: current + last, maxChars });
  }

  // A last line with no break after it still counts as a line.
  if (current !== '') finishLine();

  return { window, total, endsWithNewline, hash: hash.digest('hex') };
}

/** The start of a line that is as long as a read can use, so one huge line costs a bounded buffer. */
function keepStart(params: { line: string; maxChars: number }): string {
  return params.line.slice(0, params.maxChars + 1);
}
