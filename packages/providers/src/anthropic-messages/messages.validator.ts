import { z } from 'zod';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

// The streamed Messages API events we read; any other event type (`message_start`, `ping`) fails
// to parse and is skipped.

const contentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().default('') }),
  z.object({ type: z.literal('tool_use'), id: callIdSchema, name: z.string() }),
  z.object({
    type: z.literal('thinking'),
    thinking: z.string().default(''),
    signature: z.string().default(''),
  }),
  z.object({ type: z.literal('redacted_thinking'), data: z.string() }),
]);

const replayBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('tool_use'), id: callIdSchema, name: z.string(), input: z.unknown() }),
  z.object({ type: z.literal('thinking'), thinking: z.string(), signature: z.string() }),
  z.object({ type: z.literal('redacted_thinking'), data: z.string() }),
]);

export const messagesReplaySchema = z.object({
  type: z.literal('messages-replay'),
  prefix: z.string(),
  content: z.array(replayBlockSchema),
});

const deltaSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text_delta'), text: z.string() }),
  z.object({ type: z.literal('input_json_delta'), partial_json: z.string() }),
  z.object({ type: z.literal('thinking_delta'), thinking: z.string() }),
  z.object({ type: z.literal('signature_delta'), signature: z.string() }),
]);

export const messagesEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('content_block_start'),
    index: z.number().int().min(0),
    content_block: contentBlockSchema,
  }),
  z.object({
    type: z.literal('content_block_delta'),
    index: z.number().int().min(0),
    delta: deltaSchema,
  }),
  z.object({ type: z.literal('content_block_stop'), index: z.number().int().min(0) }),
  z.object({
    type: z.literal('message_delta'),
    delta: z.object({ stop_reason: z.string().nullish() }),
  }),
  z.object({ type: z.literal('message_stop') }),
  // Mid-stream errors (`overloaded_error`) arrive as HTTP 200 + this event.
  z.object({
    type: z.literal('error'),
    error: z.object({ type: z.string(), message: z.string() }),
  }),
]);
