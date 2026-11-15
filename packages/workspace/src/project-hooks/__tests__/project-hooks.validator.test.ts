import { describe, expect, it } from 'vitest';
import { handlerNames } from '@sheavly/core/hook/hook.utils';
import { hooksManifestSchema, parseHookExport } from '../project-hooks.validator.js';

describe('hooksManifestSchema', () => {
  it('accepts a manifest and defaults `enabled` to true', () => {
    expect(hooksManifestSchema.parse({ version: 1, hooks: [{ path: 'hooks/audit.js' }] })).toEqual({
      version: 1,
      hooks: [{ path: 'hooks/audit.js', enabled: true }],
    });
  });

  it('rejects another version, a missing hooks list and unknown keys', () => {
    expect(hooksManifestSchema.safeParse({ version: 2, hooks: [] }).success).toBe(false);
    expect(hooksManifestSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(hooksManifestSchema.safeParse({ version: 1, hooks: [], hook: [] }).success).toBe(false);
    expect(
      hooksManifestSchema.safeParse({ version: 1, hooks: [{ path: 'a.js', enable: false }] })
        .success,
    ).toBe(false);
  });

  it('rejects a hook file with an extension Node does not load', () => {
    const result = hooksManifestSchema.safeParse({ version: 1, hooks: [{ path: 'hooks/a.py' }] });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('A hook file must end in one of');
  });
});

describe('parseHookExport', () => {
  it('accepts a named hook with at least one handler', () => {
    const exported = { name: 'audit', afterTurn: () => undefined };

    expect(parseHookExport(exported)).toEqual({ hook: exported });
  });

  it('accepts a hook that only defines beforeModelCall', () => {
    const exported = { name: 'trim', beforeModelCall: async () => [] };

    expect(parseHookExport(exported)).toEqual({ hook: exported });
  });

  it('rejects a beforeModelCall that is not a function', () => {
    expect(parseHookExport({ name: 'trim', beforeModelCall: [] })).toHaveProperty('error');
  });

  it('accepts a hook that only defines beforeSummary or afterSummary', () => {
    const before = { name: 'keep', beforeSummary: async () => undefined };
    const after = { name: 'restore', afterSummary: async () => undefined };

    expect(parseHookExport(before)).toEqual({ hook: before });
    expect(parseHookExport(after)).toEqual({ hook: after });
  });

  it.each(handlerNames())(
    'accepts a hook that only defines %s, and rejects it as a non-function',
    (name) => {
      const exported = { name: 'any', [name]: async () => undefined };

      expect(parseHookExport(exported)).toEqual({ hook: exported });
      expect(parseHookExport({ name: 'any', [name]: 'no' })).toHaveProperty('error');
    },
  );

  it('accepts after as a list of hook names, and rejects anything else', () => {
    const exported = { name: 'late', after: ['early'], afterTurn: async () => undefined };

    expect(parseHookExport(exported)).toEqual({ hook: exported });
    expect(parseHookExport({ ...exported, after: 'early' })).toHaveProperty('error');
    expect(parseHookExport({ ...exported, after: [''] })).toHaveProperty('error');
  });

  it('caps a hook name, and how many hooks and how long a name after may hold', () => {
    const base = { name: 'late', afterTurn: async () => undefined };

    expect(parseHookExport({ ...base, name: 'n'.repeat(101) })).toHaveProperty('error');
    expect(parseHookExport({ ...base, after: Array(33).fill('a') })).toHaveProperty('error');
    expect(parseHookExport({ ...base, after: ['a'.repeat(101)] })).toHaveProperty('error');
    expect(parseHookExport({ ...base, after: Array(32).fill('a') })).not.toHaveProperty('error');
  });

  it('rejects a summary handler that is not a function', () => {
    expect(parseHookExport({ name: 'keep', beforeSummary: {} })).toHaveProperty('error');
    expect(parseHookExport({ name: 'restore', afterSummary: 'no' })).toHaveProperty('error');
  });

  it('names every handler when a hook handles nothing, read from HANDLERS', () => {
    const result = parseHookExport({ name: 'idle' });
    const message = 'error' in result ? result.error : '';

    for (const name of handlerNames()) expect(message).toContain(name);

    expect(message).toContain('beforeSummary, afterSummary');
  });

  it('rejects a hook that handles nothing, with the reason', () => {
    const result = parseHookExport({ name: 'idle' });

    expect(result).toHaveProperty('error');
    expect('error' in result && result.error).toContain('Define at least one handler');
  });

  it('rejects a missing name, a handler that is not a function, and unknown keys', () => {
    expect(parseHookExport({ afterTurn: () => undefined })).toHaveProperty('error');
    expect(parseHookExport({ name: 'a', afterTurn: 'not a function' })).toHaveProperty('error');
    expect(
      parseHookExport({ name: 'a', afterTurn: () => undefined, before: () => 1 }),
    ).toHaveProperty('error');
  });

  it('rejects a module that exports nothing usable', () => {
    expect(parseHookExport(undefined)).toHaveProperty('error');
    expect(parseHookExport(() => undefined)).toHaveProperty('error');
  });
});
