import { randomBytes } from 'node:crypto';
import { instanceIdSchema } from '@sheavly/protocol/handshake/handshake.validator';
import type { InstanceId } from '@sheavly/protocol/handshake/handshake.types';
import { INSTANCE_ID_BYTES } from './instance-id.constants.js';

/**
 * A fresh id for one server start: 32 random bytes as 43 characters of unpadded base64url. It is
 * a secret salt of the handshake proof, never returned by any route.
 */
export function newInstanceId(): InstanceId {
  return instanceIdSchema.parse(randomBytes(INSTANCE_ID_BYTES).toString('base64url'));
}
