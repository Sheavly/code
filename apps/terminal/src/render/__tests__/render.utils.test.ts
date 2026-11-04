import { describe, expect, it } from 'vitest';
import { firstLine, projectTrustNotice } from '../render.utils.js';

describe('firstLine', () => {
  it('drops escape codes, so a cut never leaves a style on for what follows', () => {
    const dim = `\u001B[2m${'x'.repeat(120)}\u001B[22m`;

    expect(firstLine(`\n${dim}\nnext`)).toBe(`${'x'.repeat(100)}…`);
  });

  it('skips a line that is only escape codes', () => {
    expect(firstLine('\u001B[2m\u001B[22m\nkept')).toBe('kept');
  });
});

describe('projectTrustNotice', () => {
  it('says why .sheavly/ hooks were skipped, and how to trust them', () => {
    expect(projectTrustNotice('untrusted')).toMatch(/not trusted.*--trust/);
    expect(projectTrustNotice('changed')).toMatch(/changed since you trusted.*--trust/);
  });

  it('says nothing when the hooks ran or there were none', () => {
    expect(projectTrustNotice('trusted')).toBeUndefined();
    expect(projectTrustNotice('no_hooks')).toBeUndefined();
  });
});
