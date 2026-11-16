import { describe, expect, it } from 'vitest';
import { outputTokenLimit } from '../output-tokens.utils.js';

const defaults = { known: 100 };

describe('outputTokenLimit', () => {
  it('lets an explicit limit win over the table', () => {
    expect(outputTokenLimit({ key: 'known', maxTokens: 5, defaults })).toBe(5);
  });

  it('uses the table for a listed key', () => {
    expect(outputTokenLimit({ key: 'known', maxTokens: undefined, defaults })).toBe(100);
  });

  it('is undefined for an unlisted key, and never reads inherited object keys', () => {
    expect(outputTokenLimit({ key: 'other', maxTokens: undefined, defaults })).toBeUndefined();
    expect(
      outputTokenLimit({ key: 'constructor', maxTokens: undefined, defaults }),
    ).toBeUndefined();
  });
});
