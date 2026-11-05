import type { z } from 'zod';
import type { StopReason, StreamEvent } from '@sheavly/core/message/message.types';
import type { CallId } from '@sheavly/protocol/message/message.types';
import type { RequestPolicy } from '../http/http.types.js';
import type { messagesEventSchema } from './messages.validator.js';

/**
 * Where and how to reach one backend that speaks the Anthropic Messages API. Backends differ only
 * in this: an adapter's `toEndpoint` maps its config to one.
 */
export type MessagesEndpoint = {
  /** Base URL including the version segment, e.g. `https://<resource>.services.ai.azure.com/anthropic/v1`. */
  baseUrl: string;
  model: string;
  /** Auth and any other headers the backend needs (`anthropic-version` is always sent). */
  headers: Record<string, string>;
};

export type MessagesThinkingMode = 'adaptive' | 'enabled' | 'disabled';

export type MessagesProviderConfig = {
  endpoint: MessagesEndpoint;
  /** The most tokens one reply may use (the API requires it), thinking included. */
  maxTokens: number;
  /**
   * Extended thinking: how many of `maxTokens` the model may think with (at least 1024). Its
   * signed thinking blocks are kept and resent on later turns, so it keeps its chain of thought
   * across tool calls. Used only for enabled thinking; adaptive thinking takes no budget.
   */
  thinkingBudget?: number | undefined;
  /** Omitted: a budget enables thinking, otherwise the request leaves thinking unspecified. */
  thinkingMode?: MessagesThinkingMode | undefined;
  request: RequestPolicy;
  fetch: typeof fetch;
};

/** The config every Messages adapter's schema must produce, besides its own fields. */
export type MessagesAdapterConfig = {
  maxTokens: number;
  thinkingBudget?: number | undefined;
  thinkingMode?: MessagesThinkingMode | undefined;
  request: RequestPolicy;
};

/** A streamed Messages API event we use (everything else is skipped). */
export type MessagesEvent = z.infer<typeof messagesEventSchema>;

/** One content block of the reply, as it streams in, by its `index`. */
export type StreamingBlock =
  | { type: 'text' }
  | { type: 'tool_use'; id: CallId; name: string; json: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string };

/**
 * What one Messages API event means for us: events to yield, a new stop reason, or both.
 * `ended`: `message_stop` finished the turn.
 */
export type MessagesStep = { events: StreamEvent[]; stopReason?: StopReason; ended?: true };
