import { describe, expect, it } from 'vitest';
import { handshakeProofSchema, instanceIdSchema, nonceSchema } from '../handshake.validator.js';

describe('nonceSchema', () => {
  it.each([22, 43, 86])('accepts %i characters of base64url', (length) => {
    expect(nonceSchema.safeParse('a'.repeat(length)).success).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['21 characters', 'a'.repeat(21)],
    ['87 characters', 'a'.repeat(87)],
    ['padded', `${'a'.repeat(42)}=`],
    ['outside the alphabet', `${'a'.repeat(42)}!`],
    ['standard base64', `${'a'.repeat(42)}+`],
    ['a number', 123],
  ])('rejects a nonce that is %s', (_name, value) => {
    expect(nonceSchema.safeParse(value).success).toBe(false);
  });
});

describe('instanceIdSchema and handshakeProofSchema', () => {
  it.each([instanceIdSchema, handshakeProofSchema])(
    'accept exactly 43 characters of base64url',
    (schema) => {
      expect(schema.safeParse('a-_'.repeat(14).concat('Z')).success).toBe(true);
      expect(schema.safeParse('a'.repeat(42)).success).toBe(false);
      expect(schema.safeParse('a'.repeat(44)).success).toBe(false);
      expect(schema.safeParse(`${'a'.repeat(42)}=`).success).toBe(false);
    },
  );
});
