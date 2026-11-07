import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { ChatEndpoint, ChatThinkingMode } from './chat-completions.types.js';
import { chatMessages } from './input.utils.js';

/** Serializes only native Chat Completions fields, with an explicit output bound. */
export function chatRequestBody(params: {
  request: ProviderRequest;
  endpoint: ChatEndpoint;
  source: string;
  replayReasoning: boolean;
  maxTokens: number;
  thinkingMode: ChatThinkingMode | undefined;
}): Record<string, unknown> {
  const { request, endpoint, source, replayReasoning, maxTokens, thinkingMode } = params;

  return {
    model: endpoint.model,
    messages: [
      ...(request.instructions ? [{ role: 'system', content: request.instructions }] : []),
      ...chatMessages({ messages: request.messages, source, replayReasoning }),
    ],
    ...(request.tools.length > 0 && {
      tools: request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      })),
    }),
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
    ...(thinkingMode && { thinking: { type: thinkingMode } }),
    ...(request.mode &&
      thinkingMode !== 'disabled' && {
        reasoning_effort: request.mode === 'extreme' ? 'xhigh' : request.mode,
      }),
  };
}
