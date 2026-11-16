import type { Message } from '@sheavly/protocol/message/message.types';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils';
import { ownReplay } from '../http/replay.utils.js';
import type { ReplayDropHandler } from '../http/replay.types.js';
import type { MessagesApiMessage } from './messages.types.js';
import { messagesReplaySchema } from './messages.validator.js';
import { messagesPrefix } from './prefix.utils.js';

// Translation from our Message shape to Messages API messages.

type Block = Record<string, unknown>;

/**
 * The history as Messages API messages. Tool results are user content, and runs of the same role
 * (several tool results, then the next user message) are joined into one message, since the API
 * wants roles to alternate and a turn's tool results together. Empty text is left out (the API
 * rejects an empty text block), and so is a message left with nothing in it.
 *
 * Replays completed replies in their original order. Legacy thinking without prefix provenance,
 * or thinking whose instructions, tools or preceding messages changed, is not replayed.
 */
export function toMessagesApiMessages(params: {
  messages: Message[];
  reasoningSource: string | undefined;
  instructions: string | undefined;
  tools: Block[];
  onReplayDropped?: ReplayDropHandler | undefined;
}): MessagesApiMessage[] {
  const { messages, reasoningSource, onReplayDropped } = params;
  const joined: MessagesApiMessage[] = [];

  for (const message of messages) {
    const prefix = messagesPrefix({
      instructions: params.instructions,
      tools: params.tools,
      messages: joined,
    });
    const next = toMessage({ message, reasoningSource, prefix, onReplayDropped });
    const last = joined.at(-1);

    if (next.content.length === 0) continue;

    if (last?.role === next.role) last.content.push(...next.content);
    else joined.push(next);
  }

  return joined;
}

/**
 * The messages to send: `messages` plus notices as text in the last user message (the API
 * wants roles to alternate, and the last one is a user's after a prompt or tool results), or as a
 * user message of its own. A copy: `messages` is left as it was.
 */
export function withNotices(params: {
  messages: MessagesApiMessage[];
  notices: ProviderRequest['notices'];
}): MessagesApiMessage[] {
  const { messages, notices = [] } = params;

  if (notices.length === 0) return messages;

  const blocks = notices.map((notice) => ({ type: 'text', text: formatHarnessNotice(notice) }));
  const last = messages.at(-1);

  if (last?.role !== 'user') return [...messages, { role: 'user', content: blocks }];

  return [...messages.slice(0, -1), { ...last, content: [...last.content, ...blocks] }];
}

/** A replay envelope retains block boundaries, including thinking between text and tool calls. */
function toMessage(params: {
  message: Message;
  reasoningSource: string | undefined;
  prefix: string;
  onReplayDropped: ReplayDropHandler | undefined;
}): MessagesApiMessage {
  const { message, reasoningSource, prefix, onReplayDropped } = params;
  const text = (value: string): Block[] => (value ? [{ type: 'text', text: value }] : []);

  switch (message.role) {
    case 'user':
      return { role: 'user', content: text(message.content) };

    case 'assistant': {
      const content = replayContent({ message, reasoningSource, prefix, onReplayDropped });

      if (content) return { role: 'assistant', content };

      return {
        role: 'assistant',
        content: [
          ...text(message.content),
          ...message.toolCalls.map((call) => ({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: toolInput(call.input),
          })),
        ],
      };
    }

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

function replayContent(params: {
  message: Extract<Message, { role: 'assistant' }>;
  reasoningSource: string | undefined;
  prefix: string;
  onReplayDropped: ReplayDropHandler | undefined;
}): Block[] | undefined {
  const { message, reasoningSource, prefix, onReplayDropped } = params;
  const [replay] = ownReplay({
    items: message.reasoning,
    source: reasoningSource,
    onDropped: onReplayDropped,
  });

  if (!replay) return undefined;

  const parsed = messagesReplaySchema.safeParse(replay.data);

  if (!parsed.success) {
    onReplayDropped?.({ reason: 'invalid_state', source: replay.source });

    return undefined;
  }

  const { content } = parsed.data;
  const text = content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  const calls = content.flatMap((block) =>
    block.type === 'tool_use' ? [{ id: block.id, name: block.name, input: block.input }] : [],
  );

  // A caller may have edited this message while leaving its old opaque replay state attached.
  if (text !== message.content || JSON.stringify(calls) !== JSON.stringify(message.toolCalls)) {
    onReplayDropped?.({ reason: 'message_edited', source: replay.source });

    return undefined;
  }

  const kept = content.filter(
    (block) => parsed.data.prefix === prefix || block.type === 'text' || block.type === 'tool_use',
  );

  if (kept.length < content.length) {
    onReplayDropped?.({ reason: 'prefix_changed', source: replay.source });
  }

  return kept;
}

/**
 * The API takes a tool call's input as an object only. Input that wasn't one (arguments that
 * weren't valid JSON, kept raw so the tool could reject them) is resent as an empty object: the
 * tool's error result that follows says what was wrong.
 */
function toolInput(input: unknown): unknown {
  return typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {};
}
