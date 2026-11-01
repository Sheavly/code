import type { z } from 'zod';
import type { StopReason, StreamEvent } from '@sheavly/core/message/message.types';
import type { responsesEventSchema } from './responses.utils.js';

/**
 * Shared Provider config for any backend that speaks the OpenAI Responses API
 * (OpenAI, Azure OpenAI, AstraAPI, ...). Backends differ only in URL, auth headers and model.
 */
export type ResponsesConfig = {
  /** Base URL including the version segment, e.g. `https://api.openai.com/v1`. */
  baseUrl: string;
  model: string;
  headers: Record<string, string>;
  /** Extra query parameters, e.g. Azure's `api-version`. */
  query?: Record<string, string>;
  /**
   * Request encrypted reasoning and resend it on later turns (default true).
   * We run stateless (`store: false`), so this is how the model keeps its chain of thought
   * across tool calls.
   */
  reasoning?: boolean;
  fetch: typeof fetch;
};

/** A streamed Responses API event we use (everything else is skipped). */
export type ResponsesEvent = z.infer<typeof responsesEventSchema>;

/** What one Responses API event means for us: something to yield, a new stop reason, or both. */
export type EventStep = { event?: StreamEvent; stopReason?: StopReason };

/** The function call fields we read from a `function_call` output item. */
export type FunctionCallItem = { call_id: string; name: string; arguments: string };
