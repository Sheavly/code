import { describe, expect, it } from 'vitest';
import { lowercaseUuidSchema } from '../id.validator.js';

const ID = '4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30';

describe('lowercaseUuidSchema', () => {
  it('takes a UUID in lowercase', () => {
    expect(lowercaseUuidSchema.parse(ID)).toBe(ID);
  });

  it('refuses capitals: one thing must not have two names on a case-insensitive disk', () => {
    expect(lowercaseUuidSchema.safeParse(ID.toUpperCase()).success).toBe(false);
    expect(
      lowercaseUuidSchema.safeParse(`${ID.slice(0, 8).toUpperCase()}${ID.slice(8)}`).success,
    ).toBe(false);
  });

  it('refuses anything that is not a UUID, and anything that could name another path', () => {
    for (const bad of [
      '',
      'astra',
      '../4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30',
      '4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30/..',
      '4b1f9a523c5e4a779d640e2b7f1c8a30',
      `${ID} `,
      'CON',
    ]) {
      expect(lowercaseUuidSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});
