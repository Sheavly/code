import { z } from 'zod';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

// The streamed Responses API events we read; any other event type fails to parse and is skipped.

const functionCallItemSchema = z.object({
  type: z.literal('function_call'),
  call_id: callIdSchema,
  name: z.string(),
  arguments: z.string(),
});

/** Kept whole (`loose`) so it can be resent exactly as received. Useless without encrypted_content. */
const reasoningOutputItemSchema = z.looseObject({
  type: z.literal('reasoning'),
  encrypted_content: z.string().min(1),
});

const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  input_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative() }).nullish(),
});

export const responsesEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('response.output_text.delta'), delta: z.string() }),
  z.object({
    type: z.literal('response.output_item.done'),
    item: z.discriminatedUnion('type', [functionCallItemSchema, reasoningOutputItemSchema]),
  }),
  z.object({
    type: z.literal('response.completed'),
    response: z.object({ usage: usageSchema.nullish() }).optional(),
  }),
  z.object({
    type: z.literal('response.incomplete'),
    response: z.object({
      incomplete_details: z.object({ reason: z.string() }).nullish(),
      usage: usageSchema.nullish(),
    }),
  }),
  z.object({
    type: z.literal('response.failed'),
    response: z.object({ error: z.object({ message: z.string() }).nullish() }),
  }),
  // Mid-stream errors (e.g. Azure `too_many_requests`) arrive as HTTP 200 + this event.
  z.object({
    type: z.literal('error'),
    error: z.object({ message: z.string(), code: z.string().nullish() }).optional(),
    message: z.string().optional(),
  }),
]);
