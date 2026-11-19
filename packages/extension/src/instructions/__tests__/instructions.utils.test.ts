import { describe, expect, it } from 'vitest';
import { joinInstructions } from '../instructions.utils.js';

describe('joinInstructions', () => {
  it('trims each section and separates them with a blank line', () => {
    expect(joinInstructions(['  FIRST\n', '\nSECOND  '])).toBe('FIRST\n\nSECOND');
  });

  it('drops blank and missing sections', () => {
    expect(joinInstructions(['FIRST', undefined, ' \n ', '', 'LAST'])).toBe('FIRST\n\nLAST');
  });

  it('keeps the inside of a section as written', () => {
    expect(joinInstructions(['A\n\n\nB'])).toBe('A\n\n\nB');
  });

  it('returns an empty text when nothing is left', () => {
    expect(joinInstructions([])).toBe('');
    expect(joinInstructions([undefined, ' '])).toBe('');
  });
});
