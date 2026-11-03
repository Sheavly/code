import { z } from 'zod';
import { approvalUpdateSchema } from '../approval/approval.validator.js';
import { entryEventSchema } from '../event/event.validator.js';
import { sessionIdSchema, sessionUpdateSchema } from '../session/session.validator.js';

/**
 * One entry of a session tree's combined stream: every session's loop events (sub-agents
 * included), every session update and every approval, in one causal order. `seq` counts the whole tree, 0, 1,
 * 2, ... with no gaps; `sessionId` names the session the entry is about. An `event` keeps its own
 * session's `seq` too, so a UI can also follow one session alone. Its `done` carries no
 * `messages`: the history is read on its own, so the stream (kept for replay) stays small.
 */
export const streamEntrySchema = z.intersection(
  z.object({ seq: z.number().int().nonnegative(), sessionId: sessionIdSchema }),
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('event'), event: entryEventSchema }),
    z.object({ kind: z.literal('update'), update: sessionUpdateSchema }),
    /**
     * An approval a session's tool asked for, answered or gave up on, in order with its events: a
     * client replaying the stream sees every `approval_requested` still without its answer.
     */
    z.object({ kind: z.literal('approval'), update: approvalUpdateSchema }),
  ]),
);
