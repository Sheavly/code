import { describe, expect, it } from 'vitest';
import { TRUST_STORE_VERSION } from '../trust.constants.js';
import { olderFormatHint } from '../trust.utils.js';

describe('olderFormatHint', () => {
  it('tells the user what to do when the store is of the previous format', () => {
    const hint = olderFormatHint({ version: TRUST_STORE_VERSION - 1, workspaces: {} });

    expect(hint).toContain('older version');
    expect(hint).toContain('--trust');
  });

  it('says nothing about a file that is simply wrong', () => {
    for (const json of [{ version: 99 }, { version: TRUST_STORE_VERSION }, {}, null, 'text', []]) {
      expect(olderFormatHint(json)).toBe('');
    }
  });
});
