import type { Message } from '@sheavly/protocol/message/message.types';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { ModelApiError } from '../errors/providers.errors.js';
import { chatReasoningSchema } from './chat-completions.validator.js';

/** Converts fresh message objects, excluding reasoning from other protocols/endpoints/models. */
export function chatMessages(params: {
  messages: Message[];
  source: string;
  replayReasoning: boolean;
}): Record<string, unknown>[] {
  const { messages, source, replayReasoning } = params;

  return messages.map((message) => {
    if (message.role === 'user') return { role: 'user', content: message.content };

    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }

    return {
      role: 'assistant',
      content: message.content,
      ...(replayReasoning && { reasoning_content: ownThinking({ message, source }) }),
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
}): string {
  const { message, source } = params;

  return (
    message.reasoning
      ?.filter((item) => item.source === source)
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
      .join('') ?? ''
  );
}
