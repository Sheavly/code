import type { SessionId, SessionInfo } from '@sheavly/protocol/session/session.types';
import { SessionError } from '../errors/sessions.errors.js';
import { MAX_SESSION_DEPTH } from './sessions.constants.js';

/**
 * Returns `parent` (undefined when unknown) if it is a running session that may still have a
 * sub-agent: it must exist, be running, and sit above `MAX_SESSION_DEPTH`. Throws a
 * `SessionError` otherwise.
 */
export function checkedParent(params: {
  parentId: SessionId;
  parent: SessionInfo | undefined;
}): SessionInfo {
  const { parentId, parent } = params;

  if (!parent) {
    throw new SessionError({
      reason: 'unknown_session',
      sessionId: parentId,
      message: `Unknown parent session ${parentId}: a sub-agent must belong to a session`,
    });
  }

  if (parent.state !== 'running') {
    throw new SessionError({
      reason: 'parent_ended',
      sessionId: parentId,
      message:
        parent.state === 'idle'
          ? `Parent session ${parentId} is idle between prompts; only a running session starts sub-agents`
          : `Parent session ${parentId} has ended (${parent.state}); it cannot start sub-agents`,
    });
  }

  if (parent.depth >= MAX_SESSION_DEPTH) {
    throw new SessionError({
      reason: 'too_deep',
      sessionId: parentId,
      message: `Sub-agents nest at most ${MAX_SESSION_DEPTH} levels (main session → sub-agent → sub-agent); session ${parentId} is at depth ${parent.depth}`,
    });
  }

  return parent;
}
