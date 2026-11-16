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
    ['ls -la src', 'ls *'],
    ['npx vitest run *', 'npx vitest *'],
  ])('labels an entry by its base command, without options or paths: %s', (entry, base) => {
    expect(keepsHint({ keeps: [entry] })).toBe(
      `keeps \`${base}\` allowed in this folder, for every agent`,
    );
  });
});
