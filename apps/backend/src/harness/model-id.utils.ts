import { createHash } from 'node:crypto';
import type { ModelId } from '@sheavly/protocol/model/model.types';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';

/** The namespace the ids of environment-built models are made in: fixed, so an id never changes. */
const ENV_MODELS_NAMESPACE = '6f3c1d5e-8a47-4b92-a0d1-3e5f7c9b2a14';

/** A UUID version 5 (RFC 4122): the SHA-1 of the namespace's bytes and the name, as a UUID. */
export function uuidV5(params: { namespace: string; name: string }): string {
  const namespace = Buffer.from(params.namespace.replaceAll('-', ''), 'hex');
  const bytes = createHash('sha1').update(namespace).update(params.name).digest().subarray(0, 16);

  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);

  const hex = bytes.toString('hex');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/**
 * The id of a model that only has a name in the environment (`MODELS=gpt,claude`): a UUID version
 * 5 of that name, so it is the same on every start and in every process, and what a conversation
 * stored about it still means. A model with a file in `~/.sheavly` has an id of its own instead.
 */
export function modelIdOfEnvName(name: string): ModelId {
  return modelIdSchema.parse(uuidV5({ namespace: ENV_MODELS_NAMESPACE, name }));
}
