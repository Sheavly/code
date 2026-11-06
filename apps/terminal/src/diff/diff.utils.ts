import { structuredPatch } from 'diff';
import type { StructuredPatchHunk } from 'diff';
import { DIFF_CONTEXT, DIFF_MAX_EDIT_LENGTH } from './diff.constants.js';
import type { DiffRow } from './diff.types.js';

/**
 * How many lines a change added and removed. A rewrite too big to compare counts as every line
 * of the old file removed and every line of the new one added.
 */
export function countChanges(params: { before: string | null; after: string }): {
  added: number;
  removed: number;
} {
  const { before, after } = params;
  const rows = buildDiff({ before, after, maxRows: Infinity });

  if (rows.some((row) => row.kind === 'hidden')) {
    return { added: linesOf(after).length, removed: linesOf(before ?? '').length };
  }

  return {
    added: rows.filter((row) => row.kind === 'added').length,
    removed: rows.filter((row) => row.kind === 'removed').length,
  };
}

/**
 * The rows of a file change: each change with a little context, the stretches between folded
 * into one `unchanged` row, and at most `maxRows` rows before a `hidden` row counting the changed
 * lines left out. A file the change created (`before` is `null`) is all added lines. Empty when
 * nothing changed.
 */
export function buildDiff(params: {
  before: string | null;
  after: string;
  maxRows: number;
}): DiffRow[] {
  const { before, after, maxRows } = params;
  const rows = before === null ? createdRows(after) : changedRows({ before, after });

  return capRows({ rows, maxRows });
}

function linesOf(text: string): string[] {
  if (text === '') return [];

  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
}

function createdRows(after: string): DiffRow[] {
  return linesOf(after).map((text, index) => ({ kind: 'added', no: index + 1, text }));
}

function changedRows(params: { before: string; after: string }): DiffRow[] {
  const { before, after } = params;
  const patch = structuredPatch('', '', before, after, undefined, undefined, {
    context: DIFF_CONTEXT,
    maxEditLength: DIFF_MAX_EDIT_LENGTH,
  });

  if (patch === undefined) {
    return [{ kind: 'hidden', count: Math.max(linesOf(before).length, linesOf(after).length) }];
  }

  return patch.hunks.flatMap((hunk, index) => [
    ...foldedBetween({ previous: patch.hunks[index - 1], next: hunk }),
    ...hunkRows(hunk),
  ]);
}

/** A hunk that spans no lines on one side starts at the line before it, as in `diff -u`. */
function firstLine(params: { start: number; count: number }): number {
  return params.count === 0 ? params.start + 1 : params.start;
}

function foldedBetween(params: {
  previous: StructuredPatchHunk | undefined;
  next: StructuredPatchHunk;
}): DiffRow[] {
  const { previous, next } = params;

  if (previous === undefined) return [];

  const previousEnd =
    firstLine({ start: previous.oldStart, count: previous.oldLines }) + previous.oldLines;
  const count = firstLine({ start: next.oldStart, count: next.oldLines }) - previousEnd;

  return count > 0 ? [{ kind: 'unchanged', count }] : [];
}

function hunkRows(hunk: StructuredPatchHunk): DiffRow[] {
  let oldNo = firstLine({ start: hunk.oldStart, count: hunk.oldLines });
  let newNo = firstLine({ start: hunk.newStart, count: hunk.newLines });
  const rows: DiffRow[] = [];

  for (const line of hunk.lines) {
    const text = line.slice(1);

    // Anything else is jsdiff's "\ No newline at end of file" note, which is not a line.
    if (line.startsWith('+')) {
      rows.push({ kind: 'added', no: newNo, text });
      newNo += 1;
    } else if (line.startsWith('-')) {
      rows.push({ kind: 'removed', no: oldNo, text });
      oldNo += 1;
    } else if (line.startsWith(' ')) {
      rows.push({ kind: 'context', no: newNo, text });
      oldNo += 1;
      newNo += 1;
    }
  }

  return rows;
}

function capRows(params: { rows: DiffRow[]; maxRows: number }): DiffRow[] {
  const { rows, maxRows } = params;

  if (rows.length <= maxRows) return rows;

  const left = rows.slice(maxRows).filter((row) => row.kind === 'added' || row.kind === 'removed');
  const shown = rows.slice(0, maxRows);

  // What is cut may be only context, which is not worth a note.
  return left.length === 0 ? shown : [...shown, { kind: 'hidden', count: left.length }];
}
