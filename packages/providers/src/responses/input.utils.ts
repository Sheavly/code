import type { Message } from '@sheavly/core/message/message.types';

// Translation from our Message shape to Responses API input items.

/**
 * `reasoningSource`: resend reasoning items produced by this backend + model; others are dropped
 * (another provider's encrypted reasoning would be rejected). Undefined = send none.
 *
 * Order within an assistant turn: reasoning → text → function calls, matching how the
 * Responses API emits them (the model reasons, then acts).
 */
export function toInputItems(params: {
  message: Message;
  reasoningSource: string | undefined;
}): unknown[] {
  const { message, reasoningSource } = params;

  switch (message.role) {
    case 'user':
      return [{ role: 'user', content: message.content }];
    case 'assistant':
      return [
        ...(message.reasoning ?? [])
          .filter((item) => item.source === reasoningSource)
          .map((item) => item.data),
        ...(message.content ? [{ role: 'assistant', content: message.content }] : []),
        ...message.toolCalls.map((call) => ({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.input),
        })),
      ];
    case 'tool':
      return [
        { type: 'function_call_output', call_id: message.toolCallId, output: message.content },
      ];
  }
}
