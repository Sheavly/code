import { z } from 'zod';
import { callIdSchema } from '../message/message.validator.js';
import { sessionIdSchema } from '../session/session.validator.js';

/**
 * An approval request's id, the one a UI answers with. Branded, so it can't be passed where a
 * session's, tool call's or task's id goes; it is still a plain string on the wire.
 */
export const approvalIdSchema = z.string().brand<'ApprovalId'>();

/** One argument that makes a command need approval, and why. */
export const approvalConcernSchema = z.object({ argument: z.string(), reason: z.string() });

/**
 * A UI's answer to an approval request, validated before it reaches the waiting tool: run it as
 * asked, skip it, skip it and steer the agent with a message (passed to the model in the tool
 * result), or run it and allow it for good (the command is added to the folder's allow list).
 */
export const approvalResponseSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve') }),
  z.object({ decision: z.literal('always_allow') }),
  z.object({ decision: z.literal('skip') }),
  z.object({ decision: z.literal('skip_with_message'), message: z.string().trim().min(1) }),
]);

/** What the user can answer. */
export const approvalOptionSchema = z.enum([
  'approve',
  'always_allow',
  'skip',
  'skip_with_message',
]);

/**
 * A tool is waiting for the user: "the agent wants to run this; approve it?". A UI renders it its
 * own way and answers with `ApprovalRegistry.respond`.
 */
export const approvalRequestSchema = z.object({
  /** Answer with this id. */
  id: approvalIdSchema,
  /** The tool call that is waiting (matches `tool_call_started`). */
  callId: callIdSchema,
  /** The session making the call, when a loop runs it. */
  sessionId: sessionIdSchema.exactOptional(),
  tool: z.string(),
  command: z.string(),
  concerns: z.array(approvalConcernSchema),
  options: z.array(approvalOptionSchema).readonly(),
});

/** Everything a subscriber (a UI) hears from an `ApprovalRegistry`. */
export const approvalUpdateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('approval_requested'), request: approvalRequestSchema }),
  z.object({
    type: z.literal('approval_resolved'),
    id: approvalIdSchema,
    response: approvalResponseSchema,
  }),
  /** The waiting call was interrupted before anyone answered. */
  z.object({ type: z.literal('approval_cancelled'), id: approvalIdSchema }),
]);
