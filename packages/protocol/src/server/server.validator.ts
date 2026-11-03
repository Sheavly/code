import { z } from 'zod';
import { approvalResponseSchema } from '../approval/approval.validator.js';
import { messageSchema, promptPartSchema } from '../message/message.validator.js';
import { sessionIdSchema } from '../session/session.validator.js';
import { skillInfoSchema } from '../skill/skill.validator.js';

/**
 * A conversation's id on a server. Branded, so it can't be passed where a session's id goes
 * (a conversation has one main session, but they aren't the same); a plain string on the wire.
 */
export const conversationIdSchema = z.string().brand<'ConversationId'>();

/** `POST /conversations`: start one, empty or continuing saved history. */
export const startConversationRequestSchema = z.object({
  messages: z.array(messageSchema).exactOptional(),
});

export const startConversationResponseSchema = z.object({ id: conversationIdSchema });

/**
 * A live conversation, as `GET /conversations` lists it: enough for another UI (an editor and an
 * agent window on one server) to find it and join. `session` is its main session, for a stream
 * filter; `running`, whether a prompt runs now.
 */
export const conversationSummarySchema = z.object({
  id: conversationIdSchema,
  title: z.string(),
  session: sessionIdSchema,
  running: z.boolean(),
  /** When it started (ms since the epoch). */
  startedAt: z.number(),
});

/** `GET /conversations`: every live conversation, oldest first. */
export const conversationsResponseSchema = z.object({
  conversations: z.array(conversationSummarySchema),
});

/**
 * `POST /conversations/:id/prompts`: the next prompt, as `text` (a script; `/<name>` mentions in
 * it run those skills) or as `parts` (a UI; exactly the skills picked run). One or the other.
 */
export const sendPromptRequestSchema = z.xor([
  z.object({ text: z.string().min(1) }),
  z.object({ parts: z.array(promptPartSchema).min(1) }),
]);

/**
 * `QUERY /conversations/:id/stream`: which entries of the combined stream to send. Nothing: every
 * session's. `session`: one session's, with `subtree` its sub-agents' too. `replay`: from the
 * conversation's start first. `Last-Event-ID` resumes after an entry instead.
 */
export const streamQuerySchema = z.object({
  session: sessionIdSchema.exactOptional(),
  subtree: z.boolean().exactOptional(),
  replay: z.boolean().exactOptional(),
});

/** `POST /conversations/:id/approvals/:approvalId`: the user's answer to a waiting approval. */
export const answerApprovalRequestSchema = z.object({ response: approvalResponseSchema });

/** `GET /conversations/:id/messages`: the history so far, valid to continue from. */
export const messagesResponseSchema = z.object({ messages: z.array(messageSchema) });

/** `GET /conversations/:id/skills`: the skills a prompt can run, for a UI's `/` menu. */
export const skillsResponseSchema = z.object({ skills: z.array(skillInfoSchema) });

/**
 * Why a request failed, one code per case a client handles differently. `internal` is the
 * server's own failure; every other code is the request's.
 */
export const serverErrorCodeSchema = z.enum([
  'bad_request',
  'unauthorized',
  'not_found',
  'session_running',
  'unknown_skill',
  'unknown_approval',
  'internal',
]);

/** Every failed request's body: a code to branch on and a message to show. */
export const serverErrorSchema = z.object({
  error: z.object({ code: serverErrorCodeSchema, message: z.string() }),
});
