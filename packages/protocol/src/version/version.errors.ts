import { SEMVER_FAILURE_TEXT } from './version.constants.js';
import type { SemverFailure } from './semver.types.js';

/** A string that should be a protocol version is not one (a caller skipped `protocolVersionSchema`). */
export class ProtocolVersionError extends Error {
  override name = 'ProtocolVersionError';
  readonly version: string;
  readonly reason: SemverFailure;

  constructor(params: { version: string; reason: SemverFailure }) {
    const { version, reason } = params;

    super(`Protocol version "${version}" ${SEMVER_FAILURE_TEXT[reason]}`);
    this.version = version;
    this.reason = reason;
  }
}
