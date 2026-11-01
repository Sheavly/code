import type { SessionRef } from '@sheavly/core/session/session.types';
import type { SessionRegistry } from '../runtime/sessions/sessions.service.js';

/** Starts Main → 2 → 3, so the deepest session sits at the nesting cap; returns it. */
export function startDeepestSession(sessions: SessionRegistry): SessionRef {
  const main = sessions.startMain({ title: 'Main' });
  const two = sessions.startChild({ parentId: main.id, title: '2' });

  return sessions.startChild({ parentId: two.id, title: '3' });
}
