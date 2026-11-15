import { describe, expect, it } from 'vitest';
import { hashText, newTextHash } from '../file-reads.utils.js';

describe('hashText', () => {
  it('gives the same digest for the same text, and another for other text', () => {
    expect(hashText('a\n')).toBe(hashText('a\n'));
    expect(hashText('a\n')).not.toBe(hashText('b\n'));
  });

  it('matches a hash fed in chunks, as a streaming read does', () => {
    const streamed = newTextHash().update('one\n').update('two\n').digest('hex');

    expect(streamed).toBe(hashText('one\ntwo\n'));
  });
});
