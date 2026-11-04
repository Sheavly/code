import { z } from 'zod';
import { timestampSchema } from '../time/time.validator.js';

/**
 * A session's id: the main session's and each sub-agent's. Branded, so it can't be passed where a
 * tool call's, task's or approval's id goes; it is still a plain string on the wire.
 */
export const sessionIdSchema = z.string().brand<'SessionId'>();

/**
 * Who a run is: every run (the main session and each sub-agent) has an id, and every sub-agent
 * is linked to the session that started it, so none can float free. `rootId` is the main session.
 */
export const sessionRefSchema = z.object({
  id: sessionIdSchema,
  /** The session that started this one; absent only for the main session. */
  parentId: sessionIdSchema.exactOptional(),
  /** The main session at the top of the tree (its own id for the main session). */
  rootId: sessionIdSchema,
  /** 1 for the main session, 2 for its sub-agents, 3 for theirs (the maximum). */
  depth: z.number().int().positive(),
});

/**
 * Where a session is: running a prompt, `idle` between prompts of a conversation (open, waiting
 * for the next), or ended, with how its last run ended.
 */
export const sessionStateSchema = z.enum([
  'running',
  'idle',
  'completed',
  'interrupted',
  'max_turns',
  'failed',
]);

/** How one run of a session ended: the states it can leave behind. */
export const runOutcomeSchema = sessionStateSchema.exclude(['running', 'idle']);

/** A snapshot of a session, for a UI (e.g. a sub-agent card). */
export const sessionInfoSchema = sessionRefSchema.extend({
  /** Short name, e.g. "Update ESLint rules". */
  title: z.string(),
  /** The last status the agent reported itself (`report_status`), e.g. "editing core package". */
  status: z.string().exactOptional(),
  state: sessionStateSchema,
  /** How its last run ended: set once a run finishes, whether the session went idle or ended. */
  lastOutcome: runOutcomeSchema.exactOptional(),
  startedAt: timestampSchema,
  endedAt: timestampSchema.exactOptional(),
});

/** A message waiting in a session's inbox, delivered at its next model call. */
export const inboxMessageSchema = z.object({
  /** Who sent it: `'user'`, or the id of the session that sent it (an ancestor). */
  from: z.union([z.literal('user'), sessionIdSchema]),
  content: z.string(),
  sentAt: timestampSchema,
});

/** What a session registry tells its listeners (and what its SSE stream sends). */
export const sessionUpdateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session_started'), session: sessionInfoSchema }),
  z.object({ type: z.literal('session_status'), session: sessionInfoSchema }),
  /** A message was queued for `session`; it sees it at its next model call. */
  z.object({
    type: z.literal('session_message'),
    session: sessionInfoSchema,
    message: inboxMessageSchema,
  }),
  /** A conversation's prompt finished; the session stays open for the next (`lastOutcome`). */
  z.object({ type: z.literal('session_idle'), session: sessionInfoSchema }),
  /** The next prompt of a conversation started running in the same session. */
  z.object({ type: z.literal('session_resumed'), session: sessionInfoSchema }),
  z.object({ type: z.literal('session_ended'), session: sessionInfoSchema }),
]);
