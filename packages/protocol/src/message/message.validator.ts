import { z } from 'zod';

/**
 * A tool call's id, as the model's backend gave it. Branded, so it can't be passed where a
 * session's, task's or approval's id goes; it is still a plain string on the wire.
 */
export const callIdSchema = z.string().brand<'CallId'>();

/** A tool call the model asked for. */
export const toolCallSchema = z.object({
  id: callIdSchema,
  name: z.string(),
  /** Raw input from the model. Validated with zod before the tool runs. */
  input: z.unknown(),
});

/**
 * Opaque reasoning state from the model (e.g. Responses API encrypted reasoning).
 * Kept in history and resent so the model can continue its reasoning across tool calls.
 * Only the provider that produced it can read it, so it's tagged with `source`.
 */
export const reasoningItemSchema = z.object({
  /** Identifies the backend + model that produced the item. */
  source: z.string(),
  /** Provider-specific payload, resent verbatim. */
  data: z.unknown(),
});

/** One entry of the conversation history. */
export const messageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: z.string() }),
  z.object({
    role: z.literal('assistant'),
    content: z.string(),
    toolCalls: z.array(toolCallSchema),
    reasoning: z.array(reasoningItemSchema).exactOptional(),
  }),
  z.object({
    role: z.literal('tool'),
    toolCallId: callIdSchema,
    content: z.string(),
    isError: z.boolean(),
  }),
]);

/** Why a turn ended: the model's reason, or `interrupted` if the run's signal aborted. */
export const turnStopReasonSchema = z.enum(['end_turn', 'tool_use', 'max_tokens', 'interrupted']);
