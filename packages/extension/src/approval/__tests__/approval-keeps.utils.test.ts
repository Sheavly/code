import { describe, expect, it } from 'vitest';
import { MAX_KEEP_ENTRY_CHARS, MAX_REQUEST_KEEPS } from '../approval-keeps.constants.js';
import { keepsFit } from '../approval-keeps.utils.js';

describe('keepsFit', () => {
  it('holds the limits the approvals documentation states: twenty entries of five hundred characters', () => {
    expect(MAX_REQUEST_KEEPS).toBe(20);
    expect(MAX_KEEP_ENTRY_CHARS).toBe(500);
  });

  it('accepts none, and entries up to both limits', () => {
    const most = Array.from({ length: MAX_REQUEST_KEEPS }, (_unused, index) => `cmd${index} *`);

    expect(keepsFit([])).toBe(true);
    expect(keepsFit(most)).toBe(true);
    expect(keepsFit(['x'.repeat(MAX_KEEP_ENTRY_CHARS)])).toBe(true);
  });

  it('rejects one entry too many and one character too long', () => {
    const many = Array.from({ length: MAX_REQUEST_KEEPS + 1 }, (_unused, index) => `cmd${index} *`);

    expect(keepsFit(many)).toBe(false);
    expect(keepsFit(['x'.repeat(MAX_KEEP_ENTRY_CHARS + 1)])).toBe(false);
  });
});
