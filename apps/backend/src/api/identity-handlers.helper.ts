import { handshakeProof } from '@sheavly/protocol/handshake/handshake.utils';
import type { InstanceId } from '@sheavly/protocol/handshake/handshake.types';
import { PROTOCOL_VERSION } from '@sheavly/protocol/version/protocol-version.constants';
import type { ServerVersion } from '@sheavly/protocol/version/version.types';
import type { PublicRouteName } from '@sheavly/protocol/api/api.types';
import type { ApiHandlers } from './api.types.js';

/**
 * The handlers of the public routes: they say that Sheavly runs, its two versions, and prove the
 * server holds `token` and is `instanceId`. They take no conversations, setup, workspaces or
 * permissions, so they cannot reach the user's data, keep no state and log nothing. The instance
 * id and the token go only into the proof, never into an answer.
 */
export function identityHandlers(params: {
  token: string;
  instanceId: InstanceId;
  serverVersion: ServerVersion;
}): Pick<ApiHandlers, PublicRouteName> {
  const { token, instanceId, serverVersion } = params;

  return {
    getHealth: ({ c }) =>
      c.json({ status: 'ok', serverVersion, protocolVersion: PROTOCOL_VERSION }),
    queryHandshake: async ({ c, body }) =>
      c.json({
        protocolVersion: PROTOCOL_VERSION,
        proof: await handshakeProof({
          token,
          nonce: body.nonce,
          instanceId,
          protocolVersion: PROTOCOL_VERSION,
        }),
      }),
  };
}
