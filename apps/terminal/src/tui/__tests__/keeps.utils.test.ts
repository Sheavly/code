import { describe, expect, it } from 'vitest';
import { keepsHint } from '../keeps.utils.js';

describe('keepsHint', () => {
  it('names the entry a choice would keep', () => {
    expect(keepsHint(['git log *'])).toBe('keeps `git log *` allowed in this folder');
  });

  it('lists the entries of a line of commands', () => {
    expect(keepsHint(['git log *', 'head *'])).toBe(
      'keeps `git log *`, `head *` allowed in this folder',
    );
  });

  it('shows every entry even in a long list', () => {
    expect(keepsHint(['a *', 'b *', 'c *', 'd *', 'e *'])).toBe(
      'keeps `a *`, `b *`, `c *`, `d *`, `e *` allowed in this folder',
    );
  });

  it('shows an exact command in full, since that is what it would keep', () => {
    expect(keepsHint(['ls -la src'])).toBe('keeps `ls -la src` allowed in this folder');
  });
});
