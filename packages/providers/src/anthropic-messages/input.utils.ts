import type { Message } from '@sheavly/protocol/message/message.types';

// Translation from our Message shape to Messages API messages.

type Block = Record<string, unknown>;
type MessagesApiMessage = { role: 'user' | 'assistant'; content: Block[] };

/**
 * The history as Messages API messages. Tool results are user content, and runs of the same role
 * (several tool results, then the next user message) are joined into one message, since the API
 * wants roles to alternate and a turn's tool results together. Empty text is left out (the API
 * rejects an empty text block), and so is a message left with nothing in it.
 *
 * `reasoningSource`: resend thinking blocks produced by this backend + model; others are dropped
 * (another provider's signature would be rejected). Undefined = send none.
 */
export function toMessagesApiMessages(params: {
  messages: Message[];
  reasoningSource: string | undefined;
}): MessagesApiMessage[] {
  const { messages, reasoningSource } = params;
  const joined: MessagesApiMessage[] = [];

  for (const message of messages) {
    const next = toMessage({ message, reasoningSource });
    const last = joined.at(-1);

    if (next.content.length === 0) continue;

    if (last?.role === next.role) last.content.push(...next.content);
    else joined.push(next);
  }

  return joined;
}

/** Order within an assistant turn: thinking → text → tool calls, as the API emits them. */
function toMessage(params: {
  message: Message;
  reasoningSource: string | undefined;
}): MessagesApiMessage {
  const { message, reasoningSource } = params;
  const text = (value: string): Block[] => (value ? [{ type: 'text', text: value }] : []);

  switch (message.role) {
    case 'user':
      return { role: 'user', content: text(message.content) };
    case 'assistant':
      return {
        role: 'assistant',
        content: [
          ...(message.reasoning ?? [])
            .filter((item) => item.source === reasoningSource)
            .map((item) => item.data as Block),
          ...text(message.content),
          ...message.toolCalls.map((call) => ({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: toolInput(call.input),
          })),
        ],
      };
    case 'tool':
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: message.toolCallId,
            content: message.content,
            is_error: message.isError,
          },
        ],
      };
  }
}

/**
 * The API takes a tool call's input as an object only. Input that wasn't one (arguments that
 * weren't valid JSON, kept raw so the tool could reject them) is resent as an empty object: the
 * tool's error result that follows says what was wrong.
 */
function toolInput(input: unknown): unknown {
  return typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {};
}
