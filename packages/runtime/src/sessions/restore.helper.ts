import { now } from '@sheavly/core/clock/clock.helper';
import type {
  SessionId,
  SessionInfo,
  SessionUpdate,
} from '@sheavly/protocol/session/session.types';
import { isOpen } from './sessions.utils.js';

/**
 * Puts back the sessions a stored conversation had, into `sessions`, as their last update left
 * them. One that was open when the process ended did not finish: a sub-agent becomes
 * `interrupted` for good, and the main session goes idle, so the conversation can take its next
 * prompt. Each change is passed to `emit`, so it is in the stream and in the store.
 */
export function restoreSessions(params: {
  stored: readonly SessionInfo[];
  sessions: Map<SessionId, SessionInfo>;
  emit: (update: SessionUpdate) => void;
}): void {
  const { stored, sessions, emit } = params;

  for (const session of stored) sessions.set(session.id, { ...session });

  for (const session of sessions.values()) {
    if (session.depth === 1) idleRestoredMain({ session, emit });
    else if (isOpen(session.state)) interruptRestoredChild({ session, emit });
  }
}

/** A restored main session takes the next prompt: idle, whether it was closed or cut off. */
function idleRestoredMain(params: {
  session: SessionInfo;
  emit: (update: SessionUpdate) => void;
}): void {
  const { session, emit } = params;

  if (session.state === 'idle') return;

  // A run that was still going did not finish; one that ended keeps how it did.
  if (session.state === 'running') session.lastOutcome = 'interrupted';
  session.state = 'idle';
  delete session.endedAt;
  emit({ type: 'session_idle', session });
}

function interruptRestoredChild(params: {
  session: SessionInfo;
  emit: (update: SessionUpdate) => void;
}): void {
  const { session, emit } = params;

  session.state = 'interrupted';
  session.lastOutcome = 'interrupted';
  session.endedAt = now();
  emit({ type: 'session_ended', session });
}
