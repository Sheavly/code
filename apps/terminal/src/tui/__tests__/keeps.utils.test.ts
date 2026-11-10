import { describe, expect, it } from 'vitest';
import { keepsHint } from '../keeps.utils.js';

describe('base-command approval hints', () => {
  it('shows only the command being approved and its lifetime', () => {
    expect(keepsHint({ keeps: ['git log *', 'head *'] })).toBe(
      'keeps `git log *`, `head *` allowed in this folder, for every agent',
    );
    expect(keepsHint({ keeps: ['npx eslint *'], scope: 'session' })).toBe(
      'keeps `npx eslint *` allowed for every agent in this conversation, not saved',
    );
  });

  it.each([
    ['read:find *', 'find *'],
    ['read:sed *', 'sed *'],
    ['tool:npx eslint check *', 'npx eslint *'],
    ['script:node tmp/probe.mjs *', 'node *'],
    ['exact:["cat",".env"]', 'cat *'],
    ['ls -la src', 'ls *'],
    ['npx vitest run *', 'npx vitest *'],
  ])('does not claim legacy option/path restrictions remain: %s', (legacy, base) => {
    expect(keepsHint({ keeps: [legacy] })).toBe(
      `keeps \`${base}\` allowed in this folder, for every agent`,
    );
  });
});
