import { describe, expect, it } from 'vitest';
import { TRUST_STORE_VERSION } from '../trust.constants.js';
import { trustStoreSchema } from '../trust.validator.js';

const entry = { fingerprint: 'sha256:abc', trustedAt: 1_793_620_800_000 };
const store = (workspace: object) => ({
  version: TRUST_STORE_VERSION,
  workspaces: { '/repo': workspace },
});

describe('trustStoreSchema', () => {
  it('accepts a store of trusted workspaces', () => {
    const trusted = { version: TRUST_STORE_VERSION, workspaces: { '/home/me/repo': entry } };

    expect(trustStoreSchema.parse(trusted)).toEqual(trusted);
  });

  it('refuses a store written before times were milliseconds, rather than guess at it', () => {
    const old = {
      version: 1,
      workspaces: { '/repo': { ...entry, trustedAt: '2026-11-02T12:00:00.000Z' } },
    };

    expect(trustStoreSchema.safeParse(old).success).toBe(false);
    expect(trustStoreSchema.safeParse({ ...old, version: TRUST_STORE_VERSION }).success).toBe(
      false,
    );
  });

  it('rejects another version and unknown keys', () => {
    expect(trustStoreSchema.safeParse({ version: 99, workspaces: {} }).success).toBe(false);
    expect(
      trustStoreSchema.safeParse({ version: TRUST_STORE_VERSION, workspaces: {}, extra: 1 })
        .success,
    ).toBe(false);
  });

  it('rejects an entry without a fingerprint, or with a time that is not one', () => {
    expect(trustStoreSchema.safeParse(store({ ...entry, fingerprint: '' })).success).toBe(false);

    for (const trustedAt of ['yesterday', '2026-11-02T12:00:00.000Z', -5, 1.5]) {
      expect(trustStoreSchema.safeParse(store({ ...entry, trustedAt })).success).toBe(false);
    }

    expect(trustStoreSchema.safeParse(store({ ...entry, note: 'x' })).success).toBe(false);
  });
});
