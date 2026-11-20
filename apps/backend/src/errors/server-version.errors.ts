/**
 * The backend's own version could not be read: its `package.json` is missing or unreadable
 * (`unreadable`, with the read error as `cause`), or its `version` is not a semantic version
 * (`invalid`). The server does not start without a version to report.
 */
export class ServerVersionError extends Error {
  override name = 'ServerVersionError';
  readonly reason: 'unreadable' | 'invalid';

  constructor(params: { message: string; reason: 'unreadable' | 'invalid'; cause?: unknown }) {
    const { message, reason, cause } = params;

    super(message, { cause });
    this.reason = reason;
  }
}
