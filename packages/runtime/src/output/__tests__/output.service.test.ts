import { describe, expect, it } from 'vitest';
import { OutputBuffer } from '../output.service.js';
import { OUTPUT_LINE_CHARS } from '../output.constants.js';

const open = () => new OutputBuffer({ maxChars: 30_000 });

describe('OutputBuffer', () => {
  it('keeps short output exactly, including empty lines, trailing newlines and partial chunks', () => {
    const output = open();

    for (const chunk of ['a', '\n\nb', 'c\n', 'last']) output.push(chunk);
    expect(output.text).toBe('a\n\nbc\nlast');
  });

  it('keeps the first 30 and last 70 lines, with an exact omission count', () => {
    const output = open();

    output.push(Array.from({ length: 200 }, (_, i) => `line-${i}`).join('\n') + '\n');
    expect(output.text).toContain('line-0\n');
    expect(output.text).toContain('line-29\n');
    expect(output.text).toContain('… [100 lines omitted] …');
    expect(output.text).toContain('line-130\n');
    expect(output.text).toContain('line-199\n');
    expect(output.text).not.toContain('line-30\n');
  });

  it('bounds a huge unterminated line while preserving both ends across updates', () => {
    const output = open();

    output.push('HEAD' + 'a'.repeat(2_000_000));
    output.push('z'.repeat(2_000_000) + 'TAIL');
    expect(output.text).toHaveLength(OUTPUT_LINE_CHARS);
    expect(output.text.startsWith('HEAD')).toBe(true);
    expect(output.text.endsWith('TAIL')).toBe(true);
    expect(output.text).toContain('[line shortened]');
  });

  it('never exceeds the character budget, even when every retained line is huge', () => {
    const output = open();

    for (let i = 0; i < 200; i++) {
      output.push(`${'x'.repeat(3000)}\n`);
      expect(output.text.length).toBeLessThanOrEqual(30_000);
    }

    output.push('LAST-PENDING');
    expect(output.text.length).toBeLessThanOrEqual(30_000);
    expect(output.text).toContain('lines omitted');
    expect(output.text.endsWith('LAST-PENDING')).toBe(true);
  });

  it('reserves the final tail slot for a line still being written', () => {
    const output = open();

    output.push(Array.from({ length: 200 }, (_, i) => `${i}`).join('\n') + '\n');
    output.push('pending');
    expect(output.text).toContain('… [101 lines omitted] …');
    expect(output.text.split('\n').slice(-1)).toEqual(['pending']);
  });
});
