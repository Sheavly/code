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
    prompt_tokens_details: z.object({ cached_tokens: count.optional() }).nullable().optional(),
    prompt_cache_hit_tokens: count.optional(),
  })
  .refine(
    (value) =>
      (value.prompt_tokens_details?.cached_tokens ?? value.prompt_cache_hit_tokens ?? 0) <=
      value.prompt_tokens,
  );

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
