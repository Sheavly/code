import { describe, expect, it } from 'vitest';
import { joinInstructions } from '../hooks.utils.js';

describe('joinInstructions', () => {
  it('joins the present parts with blank lines, trimmed', () => {
    expect(joinInstructions(['  Base.  ', undefined, '', 'Hook.\n'])).toBe('Base.\n\nHook.');
  });

  it('is undefined when every part is missing or blank', () => {
    expect(joinInstructions([])).toBeUndefined();
    expect(joinInstructions([undefined, ' ', '\n'])).toBeUndefined();
  });
});
