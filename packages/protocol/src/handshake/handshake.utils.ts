import {
  HMAC_ALGORITHM,
  HMAC_HASH,
  LENGTH_PREFIX_BYTES,
  NONCE_BYTES,
} from './handshake.constants.js';
import { HandshakeTokenError } from './handshake.errors.js';
import type { HandshakeInputs, HandshakeProof, Nonce } from './handshake.types.js';
import { handshakeProofSchema } from './handshake.validator.js';

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

/**
 * The bytes of `text`, or undefined unless `text` is their canonical encoding: `atob` ignores the
 * unused low bits of a last character, so several texts decode to the same bytes, and only the
 * one `toBase64Url` writes may pass.
 */
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);

  return toBase64Url(bytes) === text ? bytes : undefined;
}

/**
 * The message the proof covers: for the nonce, the instance id and the version, in that order,
 * the field's UTF-8 byte length as a big-endian uint32, then its bytes. The prefixes keep one
 * field from running into the next. A caller validates the fields (none empty or oversized).
 */
function proofMessage(inputs: Omit<HandshakeInputs, 'token'>): Uint8Array<ArrayBuffer> {
  const fields = [inputs.nonce, inputs.instanceId, inputs.protocolVersion].map((field) =>
    encoder.encode(field),
  );
  const message = new Uint8Array(
    fields.reduce((total, field) => total + LENGTH_PREFIX_BYTES + field.length, 0),
  );
  let offset = 0;

  for (const field of fields) {
    new DataView(message.buffer).setUint32(offset, field.length);
    message.set(field, offset + LENGTH_PREFIX_BYTES);
    offset += LENGTH_PREFIX_BYTES + field.length;
  }

  return message;
}

/** The HMAC key: the token's UTF-8 bytes, whatever non-empty string the token is. */
function importKey(token: string): Promise<CryptoKey> {
  if (token === '') throw new HandshakeTokenError();

  return crypto.subtle.importKey(
    'raw',
    encoder.encode(token),
    { name: HMAC_ALGORITHM, hash: HMAC_HASH },
    false,
    ['sign', 'verify'],
  );
}

/** A fresh nonce: 32 random bytes as 43 characters of unpadded base64url. */
export function newNonce(): Nonce {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
}

/**
 * The proof that a server holds `token` and is the instance `instanceId`, for `nonce` and the
 * protocol version: HMAC-SHA256 keyed with the token, as unpadded base64url. The token itself
 * and the instance id never appear in it. Throws `HandshakeTokenError` for an empty token.
 */
export async function handshakeProof(inputs: HandshakeInputs): Promise<HandshakeProof> {
  const key = await importKey(inputs.token);
  const mac = await crypto.subtle.sign(HMAC_ALGORITHM, key, proofMessage(inputs));

  return toBase64Url(new Uint8Array(mac));
}

/**
 * Whether `proof` is the proof of these inputs. The comparison is WebCrypto's `verify`, never
 * `===`, so it does not leak how much of a wrong proof matched. A proof that is not 43 characters
 * of base64url, or is not the canonical encoding of its bytes, is simply wrong. Throws
 * `HandshakeTokenError` for an empty token.
 */
export async function verifyHandshakeProof(
  inputs: HandshakeInputs & { proof: string },
): Promise<boolean> {
  const proof = handshakeProofSchema.safeParse(inputs.proof);

  const key = await importKey(inputs.token);
  const signature = proof.success ? fromBase64Url(proof.data) : undefined;

  if (!signature) return false;

  return crypto.subtle.verify(HMAC_ALGORITHM, key, signature, proofMessage(inputs));
}
