import type { SessionId } from '@sheavly/protocol/session/session.types';
import { SessionError } from '@sheavly/runtime/errors/sessions.errors';
import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { isOpen } from '@sheavly/runtime/sessions/sessions.utils';

/**
 * Throws a `SessionError` unless `id` is an open session of the run: `unknown_session` for one the
 * registry does not know, `session_ended` for one that is over. `refused` finishes the ended
 * message ("Session x has ended; <refused>"), saying what could not be done.
 */
export function requireOpenSession(params: {
  sessions: Pick<SessionRegistry, 'get'>;
  id: SessionId;
  refused: string;
}): void {
  const { sessions, id, refused } = params;
  const session = sessions.get(id);

  if (session && isOpen(session.state)) return;

  throw new SessionError({
    reason: session ? 'session_ended' : 'unknown_session',
    sessionId: id,
    message: session ? `Session ${id} has ended; ${refused}` : `Unknown session ${id}`,
  });
}
