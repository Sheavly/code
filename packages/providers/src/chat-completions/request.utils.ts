import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils';
import type {
  ChatEffortProfile,
  ChatEndpoint,
  ChatThinkingMode,
} from './chat-completions.types.js';
import { chatMessages } from './input.utils.js';

/** Serializes only native Chat Completions fields, with an explicit output bound. */
export function chatRequestBody(params: {
  request: ProviderRequest;
  endpoint: ChatEndpoint;
  source: string;
  replayReasoning: boolean;
  /** Omitted from the request when undefined: the server's own limit applies. */
  maxTokens: number | undefined;
  thinkingMode: ChatThinkingMode | undefined;
  effortProfile: ChatEffortProfile;
}): Record<string, unknown> {
  const { request, endpoint, source, replayReasoning, maxTokens, thinkingMode, effortProfile } =
    params;
  const sendsEffort = Boolean(request.mode) && thinkingMode !== 'disabled';

  return {
    model: endpoint.model,
    messages: [
      ...(request.instructions ? [{ role: 'system', content: request.instructions }] : []),
      ...chatMessages({ messages: request.messages, source, replayReasoning }),
      ...(request.notices ?? []).map((notice) => ({
        role: 'user',
        content: formatHarnessNotice(notice),
      })),
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
    ...(maxTokens !== undefined && { max_tokens: maxTokens }),
    stream: true,
    stream_options: { include_usage: true },
    ...(thinkingMode && { thinking: { type: thinkingMode } }),
    ...(sendsEffort && { reasoning_effort: nativeEffort({ mode: request.mode, effortProfile }) }),
    // Reasoning models reject a temperature, so it goes only when no effort is sent.
    ...(request.temperature !== undefined && !sendsEffort && { temperature: request.temperature }),
  };
}

function nativeEffort(params: {
  mode: ProviderRequest['mode'];
  effortProfile: ChatEffortProfile;
}): string | undefined {
  const { mode, effortProfile } = params;

  if (effortProfile === 'deepseek') {
    if (mode === 'extreme') return 'max';
    if (mode === 'medium') return 'high';

    return mode;
  }

  return mode === 'extreme' ? 'xhigh' : mode;
}
