import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { StartTask } from './tasks.types.js';

/**
 * What a work kind's caller supplies: everything about one piece of work except its policy. The
 * owner is required, so work started through a kind always stops with its session
 * (`cancelSession`) and is never left to `cancelAll`.
 */
export type WorkInput = Omit<StartTask, 'backgroundKind' | 'sessionId'> & {
  sessionId: SessionId;
};

/**
 * One piece of background work, ready to start. A kind's factory builds it from a `WorkInput` and
 * fixes the completion policy (`task` is finite and can be awaited, `service` is neither), so a
 * caller names a kind and never passes the policy.
 */
export type WorkDefinition = WorkInput & {
  backgroundKind: NonNullable<StartTask['backgroundKind']>;
};
