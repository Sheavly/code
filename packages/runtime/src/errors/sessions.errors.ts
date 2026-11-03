import type { SessionId } from '@sheavly/protocol/session/session.types';

/** Why a session operation was refused. */
type SessionFailure =
  'unknown_session' | 'parent_ended' | 'too_deep' | 'session_ended' | 'not_an_ancestor';

/**
 * A session operation was refused: an unknown session, a parent or target that has ended, a
 * sub-agent nested too deep, or a message from a session that didn't start its target.
 */
export class SessionError extends Error {
  override name = 'SessionError';
  readonly reason: SessionFailure;
  /** The session the operation was about. */
  readonly sessionId: SessionId;

  constructor(params: { reason: SessionFailure; sessionId: SessionId; message: string }) {
    const { reason, sessionId, message } = params;

    super(message);
    this.reason = reason;
    this.sessionId = sessionId;
  }
}
