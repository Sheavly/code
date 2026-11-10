import { SessionError } from '../errors/sessions.errors.js';
import { isOpen } from './sessions.utils.js';
import type { InboxMessage, SessionInfo } from '@sheavly/protocol/session/session.types';

/**
 * Throws a `SessionError` unless `from` may message `session`: it must still be open, and a
 * sender other than the user must be one of its ancestors (`lineage` is the session and every
 * ancestor), since a session steers only its own sub-agents and theirs.
 */
export function assertCanSend(params: {
  session: SessionInfo;
  from: InboxMessage['from'];
  lineage: readonly SessionInfo[];
}): void {
  const { session, from, lineage } = params;

  if (!isOpen(session.state)) {
    throw new SessionError({
      reason: 'session_ended',
      sessionId: session.id,
      message: `Session ${session.id} has ended (${session.state}); it can't receive messages`,
    });
  }

  if (from !== 'user' && !lineage.some((s) => s.id === from && s.id !== session.id)) {
    throw new SessionError({
      reason: 'not_an_ancestor',
      sessionId: session.id,
      message: `Session ${from} did not start session ${session.id} (directly or through a sub-agent)`,
    });
  }
}
