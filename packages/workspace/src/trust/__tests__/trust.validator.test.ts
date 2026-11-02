import { describe, expect, it } from 'vitest';
import { TRUST_STORE_VERSION } from '../trust.constants.js';
import { trustStoreSchema } from '../trust.validator.js';

const entry = { fingerprint: 'sha256:abc', trustedAt: '2026-11-02T12:00:00.000Z' };

describe('trustStoreSchema', () => {
  it('accepts a store of trusted workspaces', () => {
    const store = { version: TRUST_STORE_VERSION, workspaces: { '/home/me/repo': entry } };

    expect(trustStoreSchema.parse(store)).toEqual(store);
  });

  it('rejects another version and unknown keys', () => {
    expect(trustStoreSchema.safeParse({ version: 99, workspaces: {} }).success).toBe(false);
    expect(
      trustStoreSchema.safeParse({ version: TRUST_STORE_VERSION, workspaces: {}, extra: 1 })
        .success,
    ).toBe(false);
  });

  it('rejects an entry without a fingerprint, or with a date that is not ISO', () => {
    const store = (workspace: object) => ({
      version: TRUST_STORE_VERSION,
      workspaces: { '/repo': workspace },
    });

    expect(trustStoreSchema.safeParse(store({ ...entry, fingerprint: '' })).success).toBe(false);
    expect(trustStoreSchema.safeParse(store({ ...entry, trustedAt: 'yesterday' })).success).toBe(
      false,
    );
    expect(trustStoreSchema.safeParse(store({ ...entry, note: 'x' })).success).toBe(false);
  });
});
