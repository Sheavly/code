import { describe, expect, it } from 'vitest';
import { firstLine, ownLine, projectTrustNotice } from '../render.utils.js';

describe('firstLine', () => {
  it('drops escape codes, so a cut never leaves a style on for what follows', () => {
    const dim = `\u001B[2m${'x'.repeat(120)}\u001B[22m`;

    expect(firstLine(`\n${dim}\nnext`)).toBe(`${'x'.repeat(100)}…`);
  });

  it('skips a line that is only escape codes', () => {
    expect(firstLine('\u001B[2m\u001B[22m\nkept')).toBe('kept');
  });
});

describe('ownLine', () => {
  it('is the first line uncut, with a count of the lines left out', () => {
    const long = `Edited ${'deep/'.repeat(40)}a.ts (1 → 2 lines)`;

    expect(ownLine(`${long}\n\nreport\nmore`)).toBe(`${long} · +2 lines for the model`);
  });

  it('adds nothing when the result is one line, and skips blank and escape-only lines', () => {
    expect(ownLine('Created a.ts (0 → 1 lines)')).toBe('Created a.ts (0 → 1 lines)');
    expect(ownLine('\n\u001B[2m\u001B[22m\nkept')).toBe('kept');
  });

  it('is empty for an empty result, instead of throwing', () => {
    expect(ownLine('')).toBe('');
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
