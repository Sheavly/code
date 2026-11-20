import { z } from 'zod';
import { protocolVersionSchema } from '../version/version.validator.js';
import {
  BASE64URL_PATTERN,
  INSTANCE_ID_CHARS,
  NONCE_MAX_CHARS,
  NONCE_MIN_CHARS,
  PROOF_CHARS,
} from './handshake.constants.js';

/** A client's challenge: unpadded base64url of 22 to 86 characters. */
export const nonceSchema = z
  .string()
  .min(NONCE_MIN_CHARS)
  .max(NONCE_MAX_CHARS)
  .regex(BASE64URL_PATTERN);

/** A server instance's id: 43 characters of unpadded base64url (32 random bytes). */
export const instanceIdSchema = z
  .string()
  .length(INSTANCE_ID_CHARS)
  .regex(BASE64URL_PATTERN)
  .brand<'InstanceId'>();

/** The proof a server gives for a nonce: 43 characters of unpadded base64url (32 bytes). */
export const handshakeProofSchema = z.string().length(PROOF_CHARS).regex(BASE64URL_PATTERN);

/** What `QUERY /handshake` takes: the client's fresh nonce. */
export const handshakeRequestSchema = z.object({ nonce: nonceSchema });

/** What `QUERY /handshake` answers: the protocol version and the proof over the nonce, instance and version. */
export const handshakeResponseSchema = z.object({
  protocolVersion: protocolVersionSchema,
  proof: handshakeProofSchema,
});
