import { z } from 'zod';

/** One argument that makes a command need approval, and why. */
export const approvalConcernSchema = z.object({ argument: z.string(), reason: z.string() });

/**
 * A UI's answer to an approval request, validated before it reaches the waiting tool: run it as
 * asked, skip it, or skip it and steer the agent with a message (passed to the model in the tool
 * result).
 */
export const approvalResponseSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve') }),
  z.object({ decision: z.literal('skip') }),
  z.object({ decision: z.literal('skip_with_message'), message: z.string().trim().min(1) }),
]);

/** What the user can answer. */
export const approvalOptionSchema = z.enum(['approve', 'skip', 'skip_with_message']);

/**
 * A tool is waiting for the user: "the agent wants to run this; approve it?". A UI renders it its
 * own way and answers with `ApprovalRegistry.respond`.
 */
export const approvalRequestSchema = z.object({
  /** Answer with this id. */
  id: z.string(),
  /** The tool call that is waiting (matches `tool_call_started`). */
  callId: z.string(),
  /** The session making the call, when a loop runs it. */
  sessionId: z.string().exactOptional(),
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
    id: z.string(),
    response: approvalResponseSchema,
  }),
  /** The waiting call was interrupted before anyone answered. */
  z.object({ type: z.literal('approval_cancelled'), id: z.string() }),
]);
