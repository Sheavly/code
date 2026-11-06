import { z } from 'zod';
import { callIdSchema } from '../message/message.validator.js';
import { modelIdSchema, modelModeSchema } from '../model/model.validator.js';
import { timestampSchema } from '../time/time.validator.js';

/**
 * A session's id: the main session's and each sub-agent's. Branded, so it can't be passed where a
 * tool call's, task's or approval's id goes; it is still a plain string on the wire.
 */
export const sessionIdSchema = z.string().brand<'SessionId'>();

/**
 * Who a run is: the main session, or a sub-agent. A sub-agent is linked to the session that
 * started it (`parentId`) and to the tool call that did (`startedByCall`, in the parent's
 * history), so none can float free and a UI can put its card where it was started. The main
 * session has neither: a user's prompt started it. `rootId` is the main session.
 */
const mainRefSchema = z.strictObject({
  id: sessionIdSchema,
  rootId: sessionIdSchema,
  depth: z.literal(1),
});

const agentRefSchema = z.object({
  id: sessionIdSchema,
  /** The session that started this one. */
  parentId: sessionIdSchema,
  /** The `start_agent` call, in the parent session's history, that started it. */
  startedByCall: callIdSchema,
  /** The main session at the top of the tree. */
  rootId: sessionIdSchema,
  /** 2 for a sub-agent of the main session, 3 for theirs (the maximum). */
  depth: z.number().int().min(2),
});

export const sessionRefSchema = z.union([mainRefSchema, agentRefSchema]);

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
  'max_tokens',
  'context_window_exceeded',
  'failed',
]);

/** How one run of a session ended: the states it can leave behind. */
export const runOutcomeSchema = sessionStateSchema.exclude(['running', 'idle']);

/** What a session is as a UI sees it, beyond who it is: its name, state and times. */
const sessionDetails = {
  /** Short name, e.g. "Update ESLint rules". */
  title: z.string(),
  /** The last status the agent reported itself (`report_status`), e.g. "editing core package". */
  status: z.string().exactOptional(),
  state: sessionStateSchema,
  /** How its last run ended: set once a run finishes, whether the session went idle or ended. */
  lastOutcome: runOutcomeSchema.exactOptional(),
  startedAt: timestampSchema,
  endedAt: timestampSchema.exactOptional(),
  /**
   * The model it runs on now: the latest `session_model`. A session no model was recorded for
   * (a library run with no model file behind it) has none.
   */
  modelId: modelIdSchema.exactOptional(),
  mode: modelModeSchema.exactOptional(),
};

/** A snapshot of a session, for a UI (e.g. a sub-agent card). */
export const sessionInfoSchema = z.union([
  mainRefSchema.extend(sessionDetails),
  agentRefSchema.extend(sessionDetails),
]);

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
  /**
   * The model `session` runs on, at its start and at every switch. It is that session's model
   * and no other's: a sub-agent's never changes the conversation's, which is the main session's.
   * `session.modelId` is this, mirrored, so a card can show it without replaying the stream.
   */
  z.object({
    type: z.literal('session_model'),
    session: sessionInfoSchema,
    modelId: modelIdSchema,
    mode: modelModeSchema.exactOptional(),
  }),
  z.object({ type: z.literal('session_ended'), session: sessionInfoSchema }),
]);
