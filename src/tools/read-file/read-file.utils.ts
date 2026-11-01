import type { ShownLines } from './read-file.types.js';

/** A text file as lines, without the final empty "line" a trailing newline leaves. */
type Lines = { lines: string[]; endsWithNewline: boolean };

function toLines(text: string): Lines {
  const lines = text.split('\n');
  const endsWithNewline = lines.at(-1) === '';

  if (endsWithNewline) lines.pop();

  return { lines, endsWithNewline };
}

/** The 1-based, inclusive range to show, clamped into the file; `notes` say what was adjusted. */
function resolveRange(params: {
  total: number;
  startLine?: number | undefined;
  endLine?: number | undefined;
  maxLines: number;
}): { start: number; end: number; notes: string[] } {
  const { total, startLine, endLine, maxLines } = params;
  const notes: string[] = [];
  const start = Math.max(1, Math.floor(startLine ?? 1));

  if (startLine !== undefined && start !== startLine) {
    notes.push(`startLine ${startLine} isn't a line number; started at ${start}.`);
  }

  let end = Math.min(total, Math.floor(endLine ?? total));

  if (endLine !== undefined && endLine < start) {
    notes.push(`endLine ${endLine} is before startLine ${start}; read from ${start} instead.`);
    end = total;
  }

  if (end - start + 1 > maxLines) {
    end = start + maxLines - 1;
    notes.push(`read_file returns at most ${maxLines} lines per call.`);
  }

  return { start, end, notes };
}

/**
 * Keeps as many whole lines as fit in `maxChars` (cutting the first line itself if even it is
 * too long). Returns the kept lines and a note when anything was dropped.
 */
function capChars(params: { selected: string[]; start: number; maxChars: number }): {
  kept: string[];
  /** The first line itself was cut, so the shown part doesn't end where a line ends. */
  cut?: boolean;
  note?: string;
} {
  const { selected, start, maxChars } = params;

  if (selected.join('\n').length <= maxChars) return { kept: selected };

  const kept: string[] = [];
  let length = 0;

  for (const line of selected) {
    if (length + line.length + 1 > maxChars) break;
    kept.push(line);
    length += line.length + 1;
  }

  if (kept.length === 0) {
    return {
      kept: [(selected[0] ?? '').slice(0, maxChars)],
      cut: true,
      note: `line ${start} is longer than ${maxChars} characters; only its start is shown.`,
    };
  }

  return { kept, note: `read_file returns at most ${maxChars} characters per call.` };
}

/**
 * Picks lines `startLine`–`endLine` (1-based, inclusive) of `text`, at most `maxLines` lines and
 * `maxChars` characters. Fails open: an out-of-range, reversed or oversized request never errors.
 * It returns what fits, plus a note saying exactly what was left out and how to read it, and
 * `lines`: the range it returned (`whole` when that is every line of an intact file).
 */
export function selectLines(params: {
  text: string;
  startLine?: number | undefined;
  endLine?: number | undefined;
  maxLines: number;
  maxChars: number;
}): { content: string; note?: string; lines: ShownLines } {
  const { text, maxLines, maxChars } = params;

  if (text === '') return { content: '', lines: { start: 0, end: 0, total: 0, whole: true } };

  const { lines, endsWithNewline } = toLines(text);
  const total = lines.length;
  const range = resolveRange({ ...params, total, maxLines });
  const { start, notes } = range;

  if (start > total) {
    return {
      content: '',
      lines: { start, end: start - 1, total, whole: false },
      note: `[The file has ${total} lines; startLine ${start} is past the end, so there is nothing to show. Use startLine 1–${total}.]`,
    };
  }

  const {
    kept,
    cut = false,
    note,
  } = capChars({
    selected: lines.slice(start - 1, range.end),
    start,
    maxChars,
  });

  if (note) notes.push(note);

  const end = start + kept.length - 1;
  const reachedEnd = end === total;
  // The rest of the file keeps its own ending; anything cut off ends at a line break.
  const ending = cut || !reachedEnd || endsWithNewline ? '\n' : '';
  const content = `${kept.join('\n')}${ending}`;

  const whole = start === 1 && reachedEnd && !cut;
  const shown: ShownLines = { start, end, total, whole };

  if (whole && notes.length === 0) return { content, lines: shown };

  const next = reachedEnd
    ? 'That is the end of the file.'
    : `To read on, call read_file with startLine ${end + 1}.`;

  return {
    content,
    lines: shown,
    note: `[Showing lines ${start}–${end} of ${total}. ${[...notes, next].join(' ')}]`,
  };
}
