import { describe, expect, it } from 'vitest';
import { projectTrustNotice } from '../render.utils.js';

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
