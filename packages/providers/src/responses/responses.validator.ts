import { z } from 'zod';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { tokenUsageSchema } from '@sheavly/protocol/usage/usage.validator';

// The streamed Responses API events we read; any other event type fails to parse and is skipped.

const functionCallItemSchema = z.object({
  type: z.literal('function_call'),
  call_id: callIdSchema,
  name: z.string(),
  arguments: z.string(),
});

/**
 * Kept whole (`loose`) so it can be resent exactly as received. Without encrypted_content it
 * can't be resent, but it still shows the model reasoned, so it parses and only drives activity.
 */
const reasoningOutputItemSchema = z.looseObject({
  type: z.literal('reasoning'),
  encrypted_content: z.string().optional(),
});

const usageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    input_tokens_details: z
      .object({
        cached_tokens: z.number().int().nonnegative(),
        // Absent on backends that predate cache-write reporting.
        cache_write_tokens: z.number().int().nonnegative().nullish(),
      })
      .nullish(),
  })
  .refine(
    (usage) =>
      tokenUsageSchema.safeParse({
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.input_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: usage.input_tokens_details?.cache_write_tokens ?? 0,
      }).success,
    'Cache reads and writes must fit within total input tokens',
  );

export const responsesEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('response.output_text.delta'), delta: z.string() }),
  // Only the item's type is read: an added reasoning item is the earliest sign of reasoning.
  z.object({
    type: z.literal('response.output_item.added'),
    item: z.object({ type: z.string() }),
  }),
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
