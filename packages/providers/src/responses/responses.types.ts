import type { z } from 'zod';
import type { StopReason, StreamEvent } from '@sheavly/core/message/message.types';
import type { CallId } from '@sheavly/protocol/message/message.types';
import type { RequestPolicy } from '../http/http.types.js';
import type { ReplayDropHandler } from '../http/replay.types.js';
import type { responsesEventSchema } from './responses.validator.js';
import type { TokenUsage } from '@sheavly/protocol/usage/usage.types';

/**
 * Where and how to reach one backend that speaks the OpenAI Responses API. Backends differ only
 * in this: an adapter's `toEndpoint` maps its config to one.
 */
export type ResponsesEndpoint = {
  /** Base URL including the version segment, e.g. `https://api.openai.com/v1`. */
  baseUrl: string;
  model: string;
  /** Auth and any other headers the backend needs. */
  headers: Record<string, string>;
  /** Extra query parameters, e.g. Azure's `api-version`. */
  query?: Record<string, string>;
};

export type ResponsesProviderConfig = {
  endpoint: ResponsesEndpoint;
  /**
   * Request encrypted reasoning and resend it on later turns (default true).
   * We run stateless (`store: false`), so this is how the model keeps its chain of thought
   * across tool calls.
   */
  reasoning?: boolean;
  request: RequestPolicy;
  fetch: typeof fetch;
  /** Told of each reasoning item left out of a request, with why. */
  onReplayDropped?: ReplayDropHandler | undefined;
  /**
   * Mark retained history with explicit cache breakpoints (default false). Only for deployments
   * of GPT-5.6+ models that accept `prompt_cache_options`; others reject the fields.
   */
  explicitCache?: boolean | undefined;
};

/** The config every Responses adapter's schema must produce, besides its own fields. */
export type ResponsesAdapterConfig = {
  reasoning: boolean;
  request: RequestPolicy;
  explicitCache?: boolean | undefined;
};

/** A streamed Responses API event we use (everything else is skipped). */
export type ResponsesEvent = z.infer<typeof responsesEventSchema>;

/**
 * What one Responses API event means for us: something to yield, a new stop reason, or both.
 * `ended`: a terminal event (`response.completed` / `response.incomplete`) finished the turn.
 */
export type EventStep = {
  events?: StreamEvent[];
  stopReason?: StopReason;
  ended?: true;
  usage?: TokenUsage;
};

/** The function call fields we read from a `function_call` output item; the id is branded once parsed. */
export type FunctionCallItem = { call_id: CallId; name: string; arguments: string };
