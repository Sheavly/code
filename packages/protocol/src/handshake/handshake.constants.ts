/** Random bytes of a nonce `newNonce` makes: 256 bits, 43 characters in base64url. */
export const NONCE_BYTES = 32;

/** The shortest nonce a server accepts: 16 bytes of entropy in base64url. */
export const NONCE_MIN_CHARS = 22;

/** The longest nonce a server accepts: 64 bytes in base64url. */
export const NONCE_MAX_CHARS = 86;

/** An instance id: 32 random bytes in unpadded base64url. */
export const INSTANCE_ID_CHARS = 43;

/** A proof: an HMAC-SHA256 (32 bytes) in unpadded base64url. */
export const PROOF_CHARS = 43;

/** Unpadded base64url: letters, digits, `-` and `_`. */
export const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Bytes of the big-endian length written before each field of the proof's message. */
export const LENGTH_PREFIX_BYTES = 4;

export const HMAC_ALGORITHM = 'HMAC';
export const HMAC_HASH = 'SHA-256';
