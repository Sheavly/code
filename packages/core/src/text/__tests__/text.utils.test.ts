import { describe, expect, it } from 'vitest';
import { escapeTags, fenceDashes, neutralize, oneLine } from '../text.utils.js';

describe('fenceDashes', () => {
  it('is at least three dashes and longer than any run in the body', () => {
    expect(fenceDashes('')).toBe('---');
    expect(fenceDashes('a - b')).toBe('---');
    expect(fenceDashes('x ------ y')).toBe('-'.repeat(7));
  });

  it('handles a body with very many dash runs without throwing', () => {
    const body = '- item\n'.repeat(300_000);

    expect(fenceDashes(body)).toBe('---');
  });
});

describe('escapeTags and neutralize', () => {
  it('swaps every < and its lookalikes, and leaves headings alone in escapeTags', () => {
    expect(escapeTags('<a>＜b﹤〈❮')).toBe('‹a>‹b‹‹‹');
    expect(escapeTags('# heading')).toBe('# heading');
  });

  it('also escapes a heading at a line start in neutralize', () => {
    expect(neutralize('x\n  # head')).toBe('x\n  \\# head');
  });
});

describe('oneLine', () => {
  it('collapses all whitespace into single spaces', () => {
    expect(oneLine('  a\n\n# b\t c ')).toBe('a # b c');
  });
});
