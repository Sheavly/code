import { describe, expect, it } from 'vitest';
import {
  allowEntrySchema,
  permissionModeSchema,
  permissionsSchema,
} from '../permission.validator.js';

describe('permissionModeSchema', () => {
  it.each(['ask', 'always_ask', 'allow_all'])('accepts %s', (mode) => {
    expect(permissionModeSchema.parse(mode)).toBe(mode);
  });

  it.each(['', 'allow', 'sandbox', 'ASK'])('rejects %j', (mode) => {
    expect(permissionModeSchema.safeParse(mode).success).toBe(false);
  });
});

describe('allowEntrySchema', () => {
  it.each(['git status', 'git log *', 'npm run test *', 'ls', 'node scripts/a.mjs'])(
    'accepts %j',
    (entry) => {
      expect(allowEntrySchema.parse(entry)).toBe(entry);
    },
  );

  it.each([
    ['', 'is empty'],
    [' git log', 'starts with a space'],
    ['git  log', 'has a double space'],
    ['git log ', 'ends with a space'],
    ['git\tlog', 'has a tab'],
    ['git\nlog', 'has a newline'],
    ['*', 'allows every command'],
    ['* log', 'allows every program'],
    ['x'.repeat(501), 'is too long'],
  ])('rejects %j, which %s', (entry) => {
    expect(allowEntrySchema.safeParse(entry).success).toBe(false);
  });
});

describe('permissionsSchema', () => {
  it('holds a mode and the commands allowed', () => {
    expect(permissionsSchema.parse({ mode: 'ask', allow: ['git log *'] })).toEqual({
      mode: 'ask',
      allow: ['git log *'],
    });
  });

  it('needs both', () => {
    expect(permissionsSchema.safeParse({ mode: 'ask' }).success).toBe(false);
    expect(permissionsSchema.safeParse({ allow: [] }).success).toBe(false);
  });
});
