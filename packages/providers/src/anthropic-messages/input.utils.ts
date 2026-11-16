import type { Message } from '@sheavly/protocol/message/message.types';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils';
import { ownReplay, safeReplaySource } from '../http/replay.utils.js';
import type { ReplayDropHandler } from '@sheavly/core/adapter/replay.types';
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
  const { messages, reasoningSource, instructions, tools, onReplayDropped } = params;
  let joined: MessagesApiMessage[] = [];

  for (const message of messages) {
    const { next, notices } = toMessage({
      message,
      reasoningSource,
      context: { instructions, tools, history: joined },
      onReplayDropped,
    });

    if (next.content.length === 0) continue;

    // A reply whose thinking is replayed was signed over the notices its request carried, so they
    // go back into the user message before it. A reply that lost its thinking brings none.
    joined = withUserBlocks({ messages: joined, blocks: notices });

    const last = joined.at(-1);

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
  return withUserBlocks({ messages: params.messages, blocks: noticeBlocks(params.notices) });
}

/**
 * A request's notices as the text blocks that are sent. A reply keeps them in its replay state:
 * its signature covers them, so a later request sends the same text again in the same place.
 */
export function noticeBlocks(notices: ProviderRequest['notices']): NoticeBlock[] {
  return (notices ?? []).map((notice) => ({ type: 'text', text: formatHarnessNotice(notice) }));
}

type NoticeBlock = { type: 'text'; text: string };

/** `blocks` added to the last user message, or as a user message of its own. A copy. */
function withUserBlocks(params: {
  messages: MessagesApiMessage[];
  blocks: NoticeBlock[];
}): MessagesApiMessage[] {
  const { messages, blocks } = params;

  if (blocks.length === 0) return messages;

  const last = messages.at(-1);

  if (last?.role !== 'user') return [...messages, { role: 'user', content: [...blocks] }];

  return [...messages.slice(0, -1), { ...last, content: [...last.content, ...blocks] }];
}

/** What a reply's signature was made over, besides its own notices: the history before it. */
type PrefixContext = {
  instructions: string | undefined;
  tools: Block[];
  history: MessagesApiMessage[];
};

/**
 * A replay envelope retains block boundaries, including thinking between text and tool calls.
 * `notices` are the blocks to put back before an assistant message whose thinking is replayed.
 */
function toMessage(params: {
  message: Message;
  reasoningSource: string | undefined;
  context: PrefixContext;
  onReplayDropped: ReplayDropHandler | undefined;
}): { next: MessagesApiMessage; notices: NoticeBlock[] } {
  const { message, reasoningSource, context, onReplayDropped } = params;
  const text = (value: string): Block[] => (value ? [{ type: 'text', text: value }] : []);

  switch (message.role) {
    case 'user':
      return { next: { role: 'user', content: text(message.content) }, notices: [] };

    case 'assistant': {
      const replayed = replayContent({ message, reasoningSource, context, onReplayDropped });

      if (replayed) {
        return {
          next: { role: 'assistant', content: replayed.content },
          notices: replayed.notices,
        };
      }

      return {
        next: {
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
        },
        notices: [],
      };
    }

    case 'tool':
      return {
        next: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: message.toolCallId,
              content: message.content,
              is_error: message.isError,
            },
          ],
        },
        notices: [],
      };
  }
}

function replayContent(params: {
  message: Extract<Message, { role: 'assistant' }>;
  reasoningSource: string | undefined;
  context: PrefixContext;
  onReplayDropped: ReplayDropHandler | undefined;
}): { content: Block[]; notices: NoticeBlock[] } | undefined {
  const { message, reasoningSource, context, onReplayDropped } = params;
  const [replay] = ownReplay({
    items: message.reasoning,
    source: reasoningSource,
    onDropped: onReplayDropped,
  });

  if (!replay) return undefined;

  const parsed = messagesReplaySchema.safeParse(replay.data);

  const source = safeReplaySource(replay.source);

  if (!parsed.success) {
    onReplayDropped?.({ reason: 'invalid_state', source });

    return undefined;
  }

  const { content } = parsed.data;
  const text = content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  const calls = content.flatMap((block) =>
    block.type === 'tool_use' ? [{ id: block.id, name: block.name, input: block.input }] : [],
  );

  // A caller may have edited this message while leaving its old opaque replay state attached.
  if (text !== message.content || JSON.stringify(calls) !== JSON.stringify(message.toolCalls)) {
    onReplayDropped?.({ reason: 'message_edited', source });

    return undefined;
  }

  // The signature covers the notices the reply's request carried, so the check is over the history
  // with them put back. Without a stored notice this is the history as it was.
  const notices = parsed.data.notices ?? [];
  const signedPrefix = messagesPrefix({
    instructions: context.instructions,
    tools: context.tools,
    messages: withUserBlocks({ messages: context.history, blocks: notices }),
  });

  if (parsed.data.prefix === signedPrefix) return { content, notices };

  const kept = content.filter((block) => block.type === 'text' || block.type === 'tool_use');

  if (kept.length < content.length) {
    onReplayDropped?.({ reason: 'prefix_changed', source });
  }

  return { content: kept, notices: [] };
}

/**
 * The API takes a tool call's input as an object only. Input that wasn't one (arguments that
 * weren't valid JSON, kept raw so the tool could reject them) is resent as an empty object: the
 * tool's error result that follows says what was wrong.
 */
function toolInput(input: unknown): unknown {
  return typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {};
}
