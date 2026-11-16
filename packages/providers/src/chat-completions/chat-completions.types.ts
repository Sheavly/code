import type { z } from 'zod';
import type { CallId } from '@sheavly/protocol/message/message.types';
import type { RequestPolicy } from '../http/http.types.js';
import type { ReplayDropHandler } from '@sheavly/core/adapter/replay.types';
import type { chatChunkSchema } from './chat-completions.validator.js';

export type ChatChunk = z.infer<typeof chatChunkSchema>;
export type ChatThinkingMode = 'enabled' | 'disabled';
export type ChatEffortProfile = 'openai' | 'deepseek';

export type ChatEndpoint = {
  /** Full operation URL, including any API version query; reasoning provenance uses this too. */
  url: string;
  model: string;
  headers: Record<string, string>;
};

export type ChatAdapterConfig = {
  request: RequestPolicy;
  maxTokens?: number | undefined;
  replayReasoning?: boolean | undefined;
  thinkingMode?: ChatThinkingMode | undefined;
  /** Explicit native effort mapping; defaults to OpenAI without model-name inference. */
  effortProfile?: ChatEffortProfile | undefined;
};

export type ChatProviderConfig = ChatAdapterConfig & {
  endpoint: ChatEndpoint;
  fetch: typeof fetch;
  /** Told of each reasoning item left out of a request, with why. */
  onReplayDropped?: ReplayDropHandler | undefined;
};

/** Stream fragments do not yet guarantee an id, function name or complete arguments. */
export type StreamingChatCall = { id?: CallId; name: string; arguments: string };
