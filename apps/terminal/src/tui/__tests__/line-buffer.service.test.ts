import { describe, expect, it } from 'vitest';
import { LineBuffer } from '../line-buffer.service.js';

describe('LineBuffer', () => {
  it('holds a line until its newline arrives, however it is cut up', () => {
    const buffer = new LineBuffer();

    expect(buffer.push('hel')).toEqual([]);
    expect(buffer.push('lo wor')).toEqual([]);
    expect(buffer.tail).toBe('hello wor');
    expect(buffer.push('ld\nnext')).toEqual(['hello world']);
    expect(buffer.tail).toBe('next');
  });

  it('returns every line a piece finishes, and keeps blank ones', () => {
    const buffer = new LineBuffer();

    expect(buffer.push('a\n\nb\nc')).toEqual(['a', '', 'b']);
    expect(buffer.tail).toBe('c');
  });

  it('reads CRLF as one newline, even when the two arrive apart', () => {
    const buffer = new LineBuffer();

    expect(buffer.push('one\r')).toEqual([]);
    expect(buffer.push('\ntwo\r\n')).toEqual(['one', 'two']);
    expect(buffer.tail).toBe('');
  });

  it('ends the unfinished line on flush, and has nothing to flush when there is none', () => {
    const buffer = new LineBuffer();

    buffer.push('partial');
    expect(buffer.flush()).toBe('partial');
    expect(buffer.tail).toBe('');
    expect(buffer.flush()).toBeUndefined();
  });

  it('returns nothing for an empty piece', () => {
    const buffer = new LineBuffer();

    expect(buffer.push('')).toEqual([]);
    expect(buffer.tail).toBe('');
  });
});
