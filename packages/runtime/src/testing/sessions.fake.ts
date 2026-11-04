import type { SessionRegistry } from '../sessions/sessions.service.js';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { SessionRef } from '@sheavly/protocol/session/session.types';

/** Test-only: the call a sub-agent started in these tests was started by (one is as good as another). */
export const STARTED_BY = callIdSchema.parse('start-call');

/** Starts Main → 2 → 3, so the deepest session sits at the nesting cap; returns it. */
export function startDeepestSession(sessions: SessionRegistry): SessionRef {
  const main = sessions.startMain({ title: 'Main' });
  const two = sessions.startChild({ parentId: main.id, startedByCall: STARTED_BY, title: '2' });

  return sessions.startChild({ parentId: two.id, startedByCall: STARTED_BY, title: '3' });
}
