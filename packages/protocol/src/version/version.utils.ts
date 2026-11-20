import { compareSemver, isCompatible, parseSemver } from './semver.utils.js';
import type { Semver } from './semver.types.js';
import { PROTOCOL_MISMATCH_MESSAGES } from './version.constants.js';
import { ProtocolVersionError } from './version.errors.js';
import type { ProtocolCheck, ProtocolVersion } from './version.types.js';

function parseOrThrow(version: string): Semver {
  const result = parseSemver(version);

  if (!result.ok) throw new ProtocolVersionError({ version, reason: result.reason });

  return result.version;
}

/**
 * Whether a client and a server can talk: they must be on the same breaking line (see
 * `isCompatible`). When not, says which side is older by semver precedence, naming both versions
 * and the one action that fixes it.
 *
 * @throws ProtocolVersionError when either version is not a protocol version; validate input
 * with `protocolVersionSchema` first.
 */
export function checkProtocolVersion(params: {
  client: ProtocolVersion;
  server: ProtocolVersion;
}): ProtocolCheck {
  const { client, server } = params;
  const clientVersion = parseOrThrow(client);
  const serverVersion = parseOrThrow(server);

  if (isCompatible({ a: clientVersion, b: serverVersion })) return { match: true };

  const older = compareSemver({ a: clientVersion, b: serverVersion }) < 0 ? 'client' : 'server';
  const template =
    older === 'client'
      ? PROTOCOL_MISMATCH_MESSAGES.clientOlder
      : PROTOCOL_MISMATCH_MESSAGES.serverOlder;

  return {
    match: false,
    older,
    client,
    server,
    message: template.replaceAll('{client}', client).replaceAll('{server}', server),
  };
}
