import { describe, expect, it } from 'vitest';
import { selectLines } from '../read-file.utils.js';

/** "line 1\nline 2\n…\nline n\n" */
const file = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}\n`).join('');
const read = (text: string, range: { startLine?: number; endLine?: number } = {}) =>
  selectLines({ text, ...range, maxLines: 1000, maxChars: 100_000 });

describe('selectLines', () => {
  it('reports the lines it returned, and whole only for the full, uncut file', () => {
    expect(read(file(10)).lines).toEqual({ start: 1, end: 10, total: 10, whole: true });
    expect(read(file(10), { startLine: 1, endLine: 10 }).lines.whole).toBe(true);
    expect(read(file(10), { startLine: 3, endLine: 5 }).lines).toEqual({
      start: 3,
      end: 5,
      total: 10,
      whole: false,
    });
    expect(read(file(1500)).lines).toEqual({ start: 1, end: 1000, total: 1500, whole: false });
    expect(selectLines({ text: 'x'.repeat(50), maxLines: 10, maxChars: 10 }).lines.whole).toBe(
      false,
    );
  });

  it('returns a small file whole, unchanged, with no note', () => {
    expect(read('a\nb\n')).toEqual({
      content: 'a\nb\n',
      lines: { start: 1, end: 2, total: 2, whole: true },
    });
    expect(read('no trailing newline')).toMatchObject({ content: 'no trailing newline' });
    expect(read('')).toMatchObject({ content: '' });
  });

  it('caps a long file at 1000 lines and says where to continue', () => {
    const { content, note } = read(file(1500));

    expect(content.split('\n').filter(Boolean)).toHaveLength(1000);
    expect(content.endsWith('line 1000\n')).toBe(true);
    expect(note).toBe(
      '[Showing lines 1–1000 of 1500. read_file returns at most 1000 lines per call. To read on, call read_file with startLine 1001.]',
    );
  });

  it('reads lines x to y, inclusive', () => {
    expect(read(file(10), { startLine: 3, endLine: 5 })).toMatchObject({
      content: 'line 3\nline 4\nline 5\n',
      note: '[Showing lines 3–5 of 10. To read on, call read_file with startLine 6.]',
    });
  });

  it('reads from startLine to the end', () => {
    expect(read(file(10), { startLine: 9 })).toMatchObject({
      content: 'line 9\nline 10\n',
      note: '[Showing lines 9–10 of 10. That is the end of the file.]',
    });
  });

  it('continues where the note said, in 1000-line pages', () => {
    const second = read(file(2500), { startLine: 1001 });

    expect(second.content.startsWith('line 1001\n')).toBe(true);
    expect(second.note).toContain('Showing lines 1001–2000 of 2500');
    expect(second.note).toContain('startLine 2001');
  });

  describe('fails open: never an error, always what fits plus why', () => {
    it('a range over 1000 lines returns the first 1000 of it', () => {
      const { content, note } = read(file(3000), { startLine: 100, endLine: 2500 });

      expect(content.startsWith('line 100\n')).toBe(true);
      expect(content.endsWith('line 1099\n')).toBe(true);
      expect(note).toContain('Showing lines 100–1099 of 3000');
      expect(note).toContain('at most 1000 lines per call');
      expect(note).toContain('startLine 1100');
    });

    it('endLine past the end is clamped to the last line', () => {
      expect(read(file(5), { startLine: 4, endLine: 99 })).toMatchObject({
        content: 'line 4\nline 5\n',
        note: '[Showing lines 4–5 of 5. That is the end of the file.]',
      });
    });

    it('startLine past the end returns nothing, with the file length', () => {
      expect(read(file(5), { startLine: 50 })).toMatchObject({
        content: '',
        note: '[The file has 5 lines; startLine 50 is past the end, so there is nothing to show. Use startLine 1–5.]',
      });
    });

    it('a reversed range reads from startLine instead', () => {
      const { content, note } = read(file(10), { startLine: 8, endLine: 3 });

      expect(content).toBe('line 8\nline 9\nline 10\n');
      expect(note).toContain('endLine 3 is before startLine 8; read from 8 instead.');
    });

    it('zero, negative or fractional line numbers are rounded into range', () => {
      expect(read(file(3), { startLine: 0 }).note).toContain(
        "startLine 0 isn't a line number; started at 1.",
      );
      expect(read(file(3), { startLine: -5, endLine: 1 }).content).toBe('line 1\n');
      expect(read(file(5), { startLine: 2.7, endLine: 3.9 }).content).toBe('line 2\nline 3\n');
    });

    it('very long lines are capped by characters, at a whole line', () => {
      const text = `${'a'.repeat(60)}\n${'b'.repeat(60)}\n${'c'.repeat(60)}\n`;
      const { content, note } = selectLines({ text, maxLines: 1000, maxChars: 130 });

      expect(content).toBe(`${'a'.repeat(60)}\n${'b'.repeat(60)}\n`);
      expect(note).toContain('Showing lines 1–2 of 3');
      expect(note).toContain('at most 130 characters per call');
    });

    it('a single line longer than the cap is cut, not dropped', () => {
      const { content, note } = selectLines({
        text: 'x'.repeat(500),
        maxLines: 1000,
        maxChars: 100,
      });

      expect(content).toBe(`${'x'.repeat(100)}\n`);
      expect(note).toContain('line 1 is longer than 100 characters; only its start is shown.');
    });
  });
});
