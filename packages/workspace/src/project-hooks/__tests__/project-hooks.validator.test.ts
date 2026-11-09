import { describe, expect, it } from 'vitest';
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
