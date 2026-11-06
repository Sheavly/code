import { describe, expect, it } from 'vitest';
import { buildDiff, countChanges } from '../diff.utils.js';

const lines = (count: number, from = 1) =>
  Array.from({ length: count }, (_, index) => `line ${index + from}`).join('\n') + '\n';

describe('buildDiff', () => {
  it('shows a created file as added lines, numbered from 1', () => {
    expect(buildDiff({ before: null, after: 'a\nb\n', maxRows: 10 })).toEqual([
      { kind: 'added', no: 1, text: 'a' },
      { kind: 'added', no: 2, text: 'b' },
    ]);
  });

  it('shows nothing for an empty new file or a change that changed nothing', () => {
    expect(buildDiff({ before: null, after: '', maxRows: 10 })).toEqual([]);
    expect(buildDiff({ before: 'a\n', after: 'a\n', maxRows: 10 })).toEqual([]);
  });

  it('shows an edit with context, a removed line by its old number and an added one by its new', () => {
    const before = 'one\ntwo\nthree\nfour\nfive\n';
    const after = 'one\ntwo\nTHREE\nfour\nfive\n';

    expect(buildDiff({ before, after, maxRows: 20 })).toEqual([
      { kind: 'context', no: 1, text: 'one' },
      { kind: 'context', no: 2, text: 'two' },
      { kind: 'removed', no: 3, text: 'three' },
      { kind: 'added', no: 3, text: 'THREE' },
      { kind: 'context', no: 4, text: 'four' },
      { kind: 'context', no: 5, text: 'five' },
    ]);
  });

  it('numbers context by the new file when lines were added above it', () => {
    const rows = buildDiff({ before: 'a\nb\n', after: 'x\ny\na\nb\n', maxRows: 20 });

    expect(rows).toContainEqual({ kind: 'context', no: 3, text: 'a' });
    expect(rows).toContainEqual({ kind: 'added', no: 1, text: 'x' });
  });

  it('numbers a deletion at the end by the old file', () => {
    const rows = buildDiff({ before: 'a\nb\nc\n', after: 'a\nb\n', maxRows: 20 });

    expect(rows).toEqual([
      { kind: 'context', no: 1, text: 'a' },
      { kind: 'context', no: 2, text: 'b' },
      { kind: 'removed', no: 3, text: 'c' },
    ]);
  });

  it('folds the lines between two distant changes into one row', () => {
    const before = lines(30);
    const after = before.replace('line 2\n', 'two\n').replace('line 28\n', 'twenty-eight\n');
    const rows = buildDiff({ before, after, maxRows: 40 });

    expect(rows.filter((row) => row.kind === 'unchanged')).toEqual([
      { kind: 'unchanged', count: 21 },
    ]);
    expect(rows.flatMap((row) => (row.kind === 'removed' ? [row.no] : []))).toEqual([2, 28]);
  });

  it('leaves out a "no newline at end of file" note and shows the change', () => {
    const rows = buildDiff({ before: 'a\nb', after: 'a\nb\n', maxRows: 20 });

    expect(rows.every((row) => 'no' in row && row.text !== '\\ No newline at end of file')).toBe(
      true,
    );
    expect(rows.some((row) => row.kind === 'added' || row.kind === 'removed')).toBe(true);
  });

  it('cuts at the cap and says how many changed lines it left out', () => {
    const rows = buildDiff({ before: null, after: lines(100), maxRows: 12 });

    expect(rows).toHaveLength(13);
    expect(rows.at(-1)).toEqual({ kind: 'hidden', count: 88 });
  });

  it('does not mention context it cut, only changes', () => {
    const before = 'a\nb\nc\nd\ne\nf\n';
    const rows = buildDiff({ before, after: before.replace('a\n', 'A\n'), maxRows: 2 });

    expect(rows).toEqual([
      { kind: 'removed', no: 1, text: 'a' },
      { kind: 'added', no: 1, text: 'A' },
    ]);
  });

  it('gives up on a rewrite too big to compare and says how many lines it covers', () => {
    const before = lines(5000);
    const after = lines(5000, 6000);

    expect(buildDiff({ before, after, maxRows: 10 })).toEqual([{ kind: 'hidden', count: 5000 }]);
  });
});

describe('countChanges', () => {
  it('counts the lines an edit added and removed, not its context', () => {
    expect(countChanges({ before: 'a\nb\nc\n', after: 'a\nB\nB2\nc\n' })).toEqual({
      added: 2,
      removed: 1,
    });
  });

  it('counts every line of a created file as added', () => {
    expect(countChanges({ before: null, after: lines(3) })).toEqual({ added: 3, removed: 0 });
  });

  it('counts nothing for a change that changed nothing', () => {
    expect(countChanges({ before: 'a\n', after: 'a\n' })).toEqual({ added: 0, removed: 0 });
  });

  it('counts a rewrite too big to compare as all removed and all added', () => {
    expect(countChanges({ before: lines(5000), after: lines(4000, 6000) })).toEqual({
      added: 4000,
      removed: 5000,
    });
  });
});
