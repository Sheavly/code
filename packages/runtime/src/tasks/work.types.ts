import type { StartTask } from './tasks.types.js';

/** What a work kind's caller supplies: everything about one piece of work except its policy. */
export type WorkInput = Omit<StartTask, 'backgroundKind'>;

/**
 * One piece of background work, ready to start. A kind's factory builds it from a `WorkInput` and
 * fixes the completion policy (`task` is finite and can be awaited, `service` is neither), so a
 * caller names a kind and never passes the policy.
 */
export type WorkDefinition = WorkInput & {
  backgroundKind: NonNullable<StartTask['backgroundKind']>;
};
