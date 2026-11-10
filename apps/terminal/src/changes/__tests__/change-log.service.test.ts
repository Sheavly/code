import { describe, expect, it } from 'vitest';
import { ChangeLog } from '../change-log.service.js';

const change = (path: string, before: string | null, after: string | null) =>
  ({ kind: 'file_change', path, before, after }) as const;

describe('ChangeLog', () => {
  it('numbers the changes from 1, in the order they were kept, with their size', () => {
    const log = new ChangeLog();

    expect(log.keep(change('a.ts', 'a\nb\n', 'a\nB\nC\n'))).toEqual({
      number: 1,
      path: 'a.ts',
      before: 'a\nb\n',
      after: 'a\nB\nC\n',
      added: 2,
      removed: 1,
    });
    expect(log.keep(change('b.ts', null, 'x\n'))?.number).toBe(2);
    expect(log.edits.map(({ path }) => path)).toEqual(['a.ts', 'b.ts']);
  });

  it('keeps nothing for a change to an existing file that changed no line', () => {
    const log = new ChangeLog();

    expect(log.keep(change('a.ts', 'a\n', 'a\n'))).toBeUndefined();
    expect(log.edits).toEqual([]);
    expect(log.keep(change('a.ts', 'a\n', 'b\n'))?.number).toBe(1);
  });

  it('keeps a created file even when it is empty', () => {
    const log = new ChangeLog();

    expect(log.keep(change('empty.txt', null, ''))).toMatchObject({ number: 1, added: 0 });
  });

  it('keeps a deleted file, with its lines removed, even when it was empty', () => {
    const log = new ChangeLog();

    expect(log.keep(change('gone.ts', 'a\nb\n', null))).toEqual({
      number: 1,
      path: 'gone.ts',
      before: 'a\nb\n',
      after: null,
      added: 0,
      removed: 2,
    });
    expect(log.keep(change('empty.txt', '', null))).toMatchObject({ number: 2, removed: 0 });
  });
});
