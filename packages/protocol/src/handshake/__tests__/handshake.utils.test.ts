import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HandshakeTokenError } from '../handshake.errors.js';
import type { HandshakeInputs } from '../handshake.types.js';
import { handshakeProof, newNonce, verifyHandshakeProof } from '../handshake.utils.js';
import { instanceIdSchema, nonceSchema } from '../handshake.validator.js';

const TOKEN = 'correct horse battery staple 0123456789';
const NONCE = 'bm9uY2Utbm9uY2Utbm9uY2U';
const INSTANCE_ID = instanceIdSchema.parse('BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc');
const VERSION = '1.2.3';
/** Computed once with node:crypto, outside the code under test. */
const EXPECTED_PROOF = 'Gzh_iELlcEtc-sPEPch9JIe8tn02F4_W_kqRpbUFAz0';

const INPUTS: HandshakeInputs = {
  token: TOKEN,
  nonce: NONCE,
  instanceId: INSTANCE_ID,
  protocolVersion: VERSION,
};

function field(text: string): Buffer {
  const bytes = Buffer.from(text, 'utf8');
  const length = Buffer.alloc(4);

  length.writeUInt32BE(bytes.length);

  return Buffer.concat([length, bytes]);
}

/** The proof by the specified layout, with node's HMAC instead of WebCrypto. */
function referenceProof(inputs: HandshakeInputs): string {
  const message = Buffer.concat([
    field(inputs.nonce),
    field(inputs.instanceId),
    field(inputs.protocolVersion),
  ]);

  return createHmac('sha256', Buffer.from(inputs.token, 'utf8'))
    .update(message)
    .digest('base64url');
}

describe('handshakeProof', () => {
  it('gives the fixed proof for the fixed inputs', async () => {
    expect(await handshakeProof(INPUTS)).toBe(EXPECTED_PROOF);
  });

  it('agrees with an independent HMAC over the specified byte layout', async () => {
    expect(await handshakeProof(INPUTS)).toBe(referenceProof(INPUTS));
  });

  it('is deterministic', async () => {
    expect(await handshakeProof(INPUTS)).toBe(await handshakeProof(INPUTS));
  });

  it('is 43 characters of unpadded base64url holding neither the token nor the instance id', async () => {
    const proof = await handshakeProof(INPUTS);

    expect(proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(proof).not.toContain(TOKEN);
    expect(proof).not.toContain(INSTANCE_ID);
    expect(proof).not.toContain(NONCE);
  });

  it('keys with the token as UTF-8 bytes, and measures a multi-byte field in bytes', async () => {
    const inputs = { ...INPUTS, token: 'tökén-日本語-🔑', protocolVersion: '1.0.0-é.日本' };

    expect(await handshakeProof(inputs)).toBe(referenceProof(inputs));
    expect(await verifyHandshakeProof({ ...inputs, proof: referenceProof(inputs) })).toBe(true);
  });

  it('keeps fields apart: fields that run together without the lengths give different proofs', async () => {
    const id = INSTANCE_ID;
    const shifted = instanceIdSchema.parse(`${id.slice(1)}9`);
    const first = { ...INPUTS, nonce: 'ab', protocolVersion: '9.0.0' };
    // Same concatenated bytes, nonce and version each moving one character.
    const second = {
      ...INPUTS,
      nonce: `ab${id.slice(0, 1)}`,
      instanceId: shifted,
      protocolVersion: '.0.0',
    };

    expect(`${first.nonce}${first.instanceId}${first.protocolVersion}`).toBe(
      `${second.nonce}${second.instanceId}${second.protocolVersion}`,
    );
    expect(await handshakeProof(first)).not.toBe(await handshakeProof(second));
  });
});

describe('verifyHandshakeProof', () => {
  it('accepts the proof of the same inputs', async () => {
    expect(await verifyHandshakeProof({ ...INPUTS, proof: EXPECTED_PROOF })).toBe(true);
  });

  it.each([
    ['token', { token: `${TOKEN}!` }],
    ['instance id', { instanceId: instanceIdSchema.parse('A'.repeat(43)) }],
    ['version', { protocolVersion: '1.2.4' }],
    ['nonce', { nonce: 'bm9uY2Utbm9uY2Utbm9uY2V' }],
  ])('rejects a proof when the %s differs', async (_name, change) => {
    expect(await verifyHandshakeProof({ ...INPUTS, ...change, proof: EXPECTED_PROOF })).toBe(false);
  });

  it('rejects a recorded proof for another nonce (replay)', async () => {
    const recorded = await handshakeProof({ ...INPUTS, nonce: newNonce() });

    expect(await verifyHandshakeProof({ ...INPUTS, nonce: newNonce(), proof: recorded })).toBe(
      false,
    );
  });

  it('accepts only the canonical encoding: of the 64 last characters, one verifies', async () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const variants = Array.from(
      { length: alphabet.length },
      (_unused, index) => `${EXPECTED_PROOF.slice(0, -1)}${alphabet.charAt(index)}`,
    );
    const accepted: string[] = [];

    for (const proof of variants) {
      if (await verifyHandshakeProof({ ...INPUTS, proof })) accepted.push(proof);
    }

    expect(accepted).toEqual([EXPECTED_PROOF]);
  });

  it.each(['', 'short', `${EXPECTED_PROOF}=`, EXPECTED_PROOF.replace('G', '*'), 'A'.repeat(44)])(
    'rejects the malformed proof %j without throwing',
    async (proof) => {
      expect(await verifyHandshakeProof({ ...INPUTS, proof })).toBe(false);
    },
  );
});

describe('an empty token', () => {
  it('makes handshakeProof and verifyHandshakeProof throw a HandshakeTokenError', async () => {
    const inputs = { ...INPUTS, token: '' };

    await expect(handshakeProof(inputs)).rejects.toBeInstanceOf(HandshakeTokenError);
    await expect(verifyHandshakeProof({ ...inputs, proof: EXPECTED_PROOF })).rejects.toBeInstanceOf(
      HandshakeTokenError,
    );
  });

  it('is named in a message that holds no token', () => {
    expect(new HandshakeTokenError().message).toContain('empty');
    expect(new HandshakeTokenError().message).not.toContain(TOKEN);
  });
});

describe('newNonce', () => {
  it('is 43 characters of unpadded base64url and a valid nonce', () => {
    const nonce = newNonce();

    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(nonce).not.toContain('=');
    expect(nonceSchema.safeParse(nonce).success).toBe(true);
  });

  it('differs on every call', () => {
    const nonces = new Set(Array.from({ length: 1000 }, () => newNonce()));

    expect(nonces.size).toBe(1000);
  });
});
