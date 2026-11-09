import type { z } from 'zod';
import type {
  callIdSchema,
  messageSchema,
  messageIdSchema,
  promptPartSchema,
  reasoningItemSchema,
  toolCallSchema,
  turnStopReasonSchema,
} from './message.validator.js';

export type CallId = z.infer<typeof callIdSchema>;
export type MessageId = z.infer<typeof messageIdSchema>;

export type ToolCall = z.infer<typeof toolCallSchema>;

export type ReasoningItem = z.infer<typeof reasoningItemSchema>;

/** One part of what the user typed: text, or a skill they picked. */
export type PromptPart = z.infer<typeof promptPartSchema>;

export type Message = z.infer<typeof messageSchema>;

/** A tool's result, as kept in history. */
export type ToolMessage = Extract<Message, { role: 'tool' }>;

export type TurnStopReason = z.infer<typeof turnStopReasonSchema>;
