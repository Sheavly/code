import type { SessionId } from '@sheavly/protocol/session/session.types';
import { SessionError } from '../errors/sessions.errors.js';
import type { ReleasedSessions } from './released-sessions.service.js';

/** The refusal for a session the registry doesn't hold: released, or never there. */
export function missingSession(params: {
  id: SessionId;
  released: ReleasedSessions;
}): SessionError {
  const { id, released } = params;

  if (released.has(id)) {
    return new SessionError({
      reason: 'session_released',
      sessionId: id,
      message: `Session ${id} was released after its report was delivered; its history stays readable`,
    });
  }

  return new SessionError({
    reason: 'unknown_session',
    sessionId: id,
    message: `Unknown session ${id}`,
  });
}
