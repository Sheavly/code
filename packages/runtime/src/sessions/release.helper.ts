import type { SessionId, SessionInfo } from '@sheavly/protocol/session/session.types';
import { SessionError } from '../errors/sessions.errors.js';
import { isOpen } from './sessions.utils.js';

/** `id` and every session under it, from the registry's own map. */
function subtreeOf(params: { id: SessionId; sessions: Map<SessionId, SessionInfo> }) {
  const { id, sessions } = params;
  const isUnder = (session: SessionInfo): boolean => {
    if (session.id === id) return true;

    const parent = 'parentId' in session ? sessions.get(session.parentId) : undefined;

    return parent !== undefined && isUnder(parent);
  };

  return [...sessions.values()].filter(isUnder);
}

/**
 * Removes the ended session `id` and every sub-agent under it from `sessions`, and has each of
 * `holders` forget them too. Returns how many sessions went. Throws `session_running` before
 * removing anything if one of them is still open.
 */
export function releaseSubtree(params: {
  id: SessionId;
  sessions: Map<SessionId, SessionInfo>;
  holders: { forget: (id: SessionId) => void }[];
}): number {
  const { id, sessions, holders } = params;
  const subtree = subtreeOf({ id, sessions });
  const open = subtree.find((session) => isOpen(session.state));

  if (open) {
    throw new SessionError({
      reason: 'session_running',
      sessionId: open.id,
      message: `Session ${open.id} is ${open.state}; only ended sessions can be released`,
    });
  }

  for (const session of subtree) {
    sessions.delete(session.id);
    for (const holder of holders) holder.forget(session.id);
  }

  return subtree.length;
}
