import { z } from 'zod';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

const count = z.number().int().nonnegative();
const toolDelta = z.object({
  index: count,
  id: callIdSchema.optional(),
  type: z.literal('function').optional(),
  function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional(),
});
const usage = z
  .object({
    prompt_tokens: count,
    completion_tokens: count,
    prompt_tokens_details: z
      .object({ cached_tokens: count.nullable().optional() })
      .nullable()
      .optional(),
    // A null hit or miss count is unreported telemetry, not a measured zero.
    prompt_cache_hit_tokens: count.nullable().optional(),
    prompt_cache_miss_tokens: count.nullable().optional(),
  })
  // A provider's own counts disagreeing must not cost the caller a reply that already streamed:
  // the detailed count wins, misses are derived downstream, and only counts no prompt could
  // produce are refused.
  .refine((value) => {
    const hits = value.prompt_tokens_details?.cached_tokens ?? value.prompt_cache_hit_tokens;
    const misses = value.prompt_cache_miss_tokens;

    return (hits ?? 0) <= value.prompt_tokens && (misses ?? 0) <= value.prompt_tokens;
  }, 'Cache counts cannot exceed prompt tokens');

export const chatChunkSchema = z.object({
  choices: z.array(
    z.object({
      index: count,
      delta: z.object({
        content: z.string().nullable().optional(),
        reasoning_content: z.string().nullable().optional(),
        tool_calls: z.array(toolDelta).nullable().optional(),
      }),
      finish_reason: z
        .enum(['stop', 'length', 'tool_calls', 'content_filter'])
        .nullable()
        .optional(),
    }),
  ),
  usage: usage.nullable().optional(),
});

export const chatStreamEventSchema = z.union([
  z.object({ error: z.object({ message: z.string().optional() }) }),
  chatChunkSchema,
]);

/** Plain thinking is replayed only by the endpoint/model that produced it. */
export const chatReasoningSchema = z.object({
  type: z.literal('chat-reasoning'),
  content: z.string(),
});
