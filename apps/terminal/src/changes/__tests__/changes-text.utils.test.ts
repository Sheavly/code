import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ChangeLog } from '../change-log.service.js';
import { changesText, collapsedChange } from '../changes-text.utils.js';

/** A log of three changes to two files: a.ts edited twice, after b.ts was created. */
function threeChanges(): ChangeLog {
  const log = new ChangeLog();

  log.keep({ kind: 'file_change', path: 'src/a.ts', before: 'one\ntwo\n', after: 'one\nTWO\n' });
  log.keep({ kind: 'file_change', path: 'src/b.ts', before: null, after: 'x\ny\n' });
  log.keep({ kind: 'file_change', path: 'src/a.ts', before: 'one\nTWO\n', after: 'ONE\nTWO\n' });

  return log;
}

const show = (target?: string, log = threeChanges()): string =>
  stripVTControlCharacters(changesText({ edits: log.edits, target, columns: 60 }));

describe('collapsedChange', () => {
  it('is one line with the size of the change and the command that expands it', () => {
    const [edit] = threeChanges().edits;

    expect(edit && stripVTControlCharacters(collapsedChange({ edit }))).toBe(
      '    ▸ +1 −1 · /changes 1\n',
    );
  });

  it('marks a deleted file, with the lines it removed', () => {
    const log = new ChangeLog();

    log.keep({ kind: 'file_change', path: 'src/gone.ts', before: 'one\ntwo\n', after: null });

    const [edit] = log.edits;

    expect(edit && stripVTControlCharacters(collapsedChange({ edit }))).toBe(
      '    ▸ +0 −2 · deleted · /changes 1\n',
    );
  });
});

describe('changesText', () => {
  it('says there is nothing when no file changed', () => {
    expect(show(undefined, new ChangeLog())).toBe('No file changes in this chat yet.');
  });

  it('lists each file once with what all its changes came to and the changes they were', () => {
    expect(show()).toBe(
      [
        'File changes in this chat: 2 files, 3 edits, +4 −2',
        '  src/a.ts  +2 −2  #1 #3',
        '  src/b.ts  +2 −0  #2  new',
        '/changes <file> or /changes #<n> shows a diff; /changes all shows every file.',
      ].join('\n'),
    );
  });

  it('marks a deleted file in the list and shows all its lines removed', () => {
    const log = new ChangeLog();

    log.keep({ kind: 'file_change', path: 'src/a.ts', before: 'one\ntwo\n', after: 'one\nTWO\n' });
    log.keep({ kind: 'file_change', path: 'src/gone.ts', before: 'one\ntwo\n', after: null });

    expect(show(undefined, log)).toBe(
      [
        'File changes in this chat: 2 files, 2 edits, +1 −3',
        '  src/a.ts     +1 −1  #1',
        '  src/gone.ts  +0 −2  #2  deleted',
        '/changes <file> or /changes #<n> shows a diff; /changes all shows every file.',
      ].join('\n'),
    );
    expect(show('gone.ts', log)).toBe(
      ['▾ src/gone.ts · #2 +0 −2', '    1 - one', '    2 - two'].join('\n'),
    );
  });

  it('shows one change as a diff, by its number with or without the #', () => {
    const expected = ['▾ src/a.ts · #1 +1 −1', '    1   one', '    2 - two', '    2 + TWO'].join(
      '\n',
    );

    expect(show('1')).toBe(expected);
    expect(show('#1')).toBe(expected);
  });

  it('shows a file by what all its changes came to, from before the first to after the last', () => {
    expect(show('src/a.ts')).toBe(
      ['▾ src/a.ts · #1 #3 +2 −2', '    1 - one', '    2 - two', '    1 + ONE', '    2 + TWO'].join(
        '\n',
      ),
    );
  });

  it('finds a file by the end of its path', () => {
    expect(show('b.ts')).toContain('▾ src/b.ts · #2 +2 −0');
  });

  it('shows every file when asked for all, apart by a blank line', () => {
    const lines = show('all').split('\n');

    expect(lines.filter((line) => line.startsWith('▾'))).toEqual([
      '▾ src/a.ts · #1 #3 +2 −2',
      '▾ src/b.ts · #2 +2 −0',
    ]);
    expect(lines).toContain('');
  });

  it('says so, and where to look, for a change or a file there is none of', () => {
    expect(show('9')).toBe('No change #9; /changes lists them.');
    expect(show('c.ts')).toBe('No changes to c.ts; /changes lists them.');
  });

  it('asks for more of the path when two files end the same way', () => {
    const log = new ChangeLog();

    log.keep({ kind: 'file_change', path: 'x/index.ts', before: null, after: 'a\n' });
    log.keep({ kind: 'file_change', path: 'y/index.ts', before: null, after: 'b\n' });

    expect(show('index.ts', log)).toBe(
      'index.ts matches x/index.ts, y/index.ts; give more of the path.',
    );
  });

  it('says a file that came back to how it was has no net change', () => {
    const log = new ChangeLog();

    log.keep({ kind: 'file_change', path: 'a.ts', before: 'a\n', after: 'b\n' });
    log.keep({ kind: 'file_change', path: 'a.ts', before: 'b\n', after: 'a\n' });

    expect(show('a.ts', log)).toBe('▾ a.ts · #1 #2 +0 −0\n    no net change');
  });

  describe('with a way to link files', () => {
    const linkFile = (path: string): string =>
      `\u001b]8;;file:///w/${path}\u001b\\${path}\u001b]8;;\u001b\\`;
    const linked = (target?: string): string =>
      changesText({ edits: threeChanges().edits, target, columns: 60, linkFile });

    it('links each file of the list, and still lines up the columns', () => {
      const rows = stripVTControlCharacters(linked()).split('\n');

      expect(rows[1]).toBe('  src/a.ts  +2 −2  #1 #3');
      expect(linked()).toContain('\u001b]8;;file:///w/src/b.ts\u001b\\src/b.ts');
    });

    it.each(['1', 'src/a.ts', 'all'])('links the path in the header of /changes %s', (target) => {
      expect(linked(target)).toContain('\u001b]8;;file:///w/src/a.ts\u001b\\');
      expect(stripVTControlCharacters(linked(target))).toBe(show(target));
    });
  });

  it('cuts a very long diff and counts what it left out', () => {
    const log = new ChangeLog();

    log.keep({ kind: 'file_change', path: 'big.txt', before: null, after: 'x\n'.repeat(600) });

    expect(show('1', log)).toContain('… 100 more changed lines');
  });
});
