import { z } from 'zod';
import { timestampSchema } from '../time/time.validator.js';
import { skillNameSchema } from '../skill/skill.validator.js';

/**
 * A tool call's id, as the model's backend gave it. Branded, so it can't be passed where a
 * session's, task's or approval's id goes; it is still a plain string on the wire.
 */
export const callIdSchema = z.string().brand<'CallId'>();

/**
 * When a message was created. Optional on the wire, so a history saved before messages were
 * timed, or one a caller writes by hand, still reads; the harness stamps every message it makes.
 * Never sent to a model.
 */
const messageTimeSchema = timestampSchema.exactOptional();

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

/**
 * One part of what the user typed: text, or a skill they picked (a chip in a UI). A UI sends
 * parts so the harness runs exactly the skills picked, without reading `/<name>` out of text.
 */
export const promptPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('skill'), name: skillNameSchema }),
]);

/** One entry of the conversation history. */
export const messageSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('user'),
    /** What the model saw: the text, with the instructions of any skills it ran. */
    content: z.string(),
    /** What the user typed, when it ran skills: for a UI to show, never sent to the model. */
    parts: z.array(promptPartSchema).exactOptional(),
    at: messageTimeSchema,
  }),
  z.object({
    role: z.literal('assistant'),
    content: z.string(),
    toolCalls: z.array(toolCallSchema),
    reasoning: z.array(reasoningItemSchema).exactOptional(),
    at: messageTimeSchema,
  }),
  z.object({
    role: z.literal('tool'),
    toolCallId: callIdSchema,
    content: z.string(),
    isError: z.boolean(),
    at: messageTimeSchema,
  }),
]);

/** Why a turn ended: the model's reason, or `interrupted` if the run's signal aborted. */
export const turnStopReasonSchema = z.enum([
  'end_turn',
  'tool_use',
  'max_tokens',
  'context_window_exceeded',
  'interrupted',
]);
