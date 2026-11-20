/**
 * The token a proof is keyed with is empty: an empty key is no secret, and WebCrypto refuses it
 * with an opaque error. The message never holds the token.
 */
export class HandshakeTokenError extends Error {
  override name = 'HandshakeTokenError';

  constructor() {
    super('The handshake token is empty: a proof needs a non-empty token');
  }
}
