import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils';
import type {
  ChatEffortProfile,
  ChatEndpoint,
  ChatThinkingMode,
} from './chat-completions.types.js';
import type { ReplayDropHandler } from '@sheavly/core/adapter/replay.types';
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
  onReplayDropped: ReplayDropHandler | undefined;
}): Record<string, unknown> {
  const { request, endpoint, source, replayReasoning, maxTokens, thinkingMode, effortProfile } =
    params;
  const sendsEffort = Boolean(request.effort) && thinkingMode !== 'disabled';

  return {
    model: endpoint.model,
    messages: [
      ...(request.instructions ? [{ role: 'system', content: request.instructions }] : []),
      ...chatMessages({
        messages: request.messages,
        source,
        replayReasoning,
        onReplayDropped: params.onReplayDropped,
      }),
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
    ...(sendsEffort && {
      reasoning_effort: nativeEffort({ effort: request.effort, effortProfile }),
    }),
    // Reasoning models reject a temperature, so it goes only when no effort is sent.
    ...(request.temperature !== undefined && !sendsEffort && { temperature: request.temperature }),
  };
}

function nativeEffort(params: {
  effort: ProviderRequest['effort'];
  effortProfile: ChatEffortProfile;
}): string | undefined {
  const { effort, effortProfile } = params;

  if (effortProfile === 'deepseek') {
    if (effort === 'extreme') return 'max';
    if (effort === 'medium') return 'high';

    return effort;
  }

  return effort === 'extreme' ? 'xhigh' : effort;
}
