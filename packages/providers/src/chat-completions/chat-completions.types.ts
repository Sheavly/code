import type { z } from 'zod';
import type { CallId } from '@sheavly/protocol/message/message.types';
import type { RequestPolicy } from '../http/http.types.js';
import type { chatChunkSchema } from './chat-completions.validator.js';

export type ChatChunk = z.infer<typeof chatChunkSchema>;
export type ChatThinkingMode = 'enabled' | 'disabled';

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
};

export type ChatProviderConfig = ChatAdapterConfig & {
  endpoint: ChatEndpoint;
  fetch: typeof fetch;
};

/** Stream fragments do not yet guarantee an id, function name or complete arguments. */
export type StreamingChatCall = { id?: CallId; name: string; arguments: string };
