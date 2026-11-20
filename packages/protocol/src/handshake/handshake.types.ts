import type { z } from 'zod';
import type { handshakeProofSchema, instanceIdSchema, nonceSchema } from './handshake.validator.js';

export type Nonce = z.infer<typeof nonceSchema>;
export type InstanceId = z.infer<typeof instanceIdSchema>;
export type HandshakeProof = z.infer<typeof handshakeProofSchema>;

/**
 * What a proof covers; the token is the key and goes beside it, never inside. The caller
 * validates the nonce (`nonceSchema`) and parses the instance id before use.
 */
export type HandshakeInputs = {
  token: string;
  nonce: string;
  instanceId: InstanceId;
  /** The protocol version string, as the server reports it. */
  protocolVersion: string;
};
