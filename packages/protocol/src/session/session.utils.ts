import type { SessionInfo, SessionRef } from './session.types.js';

/**
 * Whether a session is the main one: only a sub-agent has a parent. The one definition every
 * reader uses, instead of comparing depth to 1 or remembering the main session's id.
 */
export function isMainSession(session: SessionRef | SessionInfo): boolean {
  return !('parentId' in session && session.parentId !== undefined);
}
