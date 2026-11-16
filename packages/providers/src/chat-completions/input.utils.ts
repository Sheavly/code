import type { Message } from '@sheavly/protocol/message/message.types';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { ModelApiError } from '../errors/providers.errors.js';
import { ownReplay } from '../http/replay.utils.js';
import type { ReplayDropHandler } from '@sheavly/core/adapter/replay.types';
import { chatReasoningSchema } from './chat-completions.validator.js';

/** Converts fresh message objects, excluding reasoning from other protocols/endpoints/models. */
export function chatMessages(params: {
  messages: Message[];
  source: string;
  replayReasoning: boolean;
  onReplayDropped?: ReplayDropHandler | undefined;
}): Record<string, unknown>[] {
  const { messages, source, replayReasoning, onReplayDropped } = params;

  return messages.map((message) => {
    if (message.role === 'user') return { role: 'user', content: message.content };

    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }

    return {
      role: 'assistant',
      content: message.content,
      ...(replayReasoning && {
        reasoning_content: ownThinking({ message, source, onReplayDropped }),
      }),
      ...(message.toolCalls.length > 0 && {
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.input) },
        })),
      }),
    };
  });
}

function ownThinking(params: {
  message: Extract<Message, { role: 'assistant' }>;
  source: string;
  onReplayDropped: ReplayDropHandler | undefined;
}): string {
  const { message, source, onReplayDropped } = params;

  return ownReplay({ items: message.reasoning, source, onDropped: onReplayDropped })
    .map(
      (item) =>
        parseOrThrow({
          schema: chatReasoningSchema,
          input: item.data,
          onInvalid: () =>
            new ModelApiError({
              reason: 'bad_payload',
              message: 'Invalid Chat Completions reasoning replay state',
            }),
        }).content,
    )
    .join('');
}
