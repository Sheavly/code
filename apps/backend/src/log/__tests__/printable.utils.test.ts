import { describe, expect, it } from 'vitest';
import { printable } from '../printable.utils.js';

describe('printable', () => {
  it('keeps the end of a long text behind an ellipsis, within the bound', () => {
    const result = printable({ text: `${'a'.repeat(20)}tail`, max: 10 });

    expect(result).toBe('…aaaaatail');
  });

  it('removes control characters and escape sequences', () => {
    expect(printable({ text: 'a\u001b[31mb\nc', max: 50 })).toBe('abc');
  });

  it('never leaves half of a surrogate pair when the cut falls inside one', () => {
    const path = '😀'.repeat(5000);
    const result = printable({ text: path, max: 8192 });

    expect(result.isWellFormed()).toBe(true);
    expect(result.length).toBeLessThanOrEqual(8192);
    expect(result.startsWith('…😀')).toBe(true);
  });
});
