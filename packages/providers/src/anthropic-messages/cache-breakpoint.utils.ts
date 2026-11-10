import { PROMPT_CACHE_CONTROL } from './messages.constants.js';
import type { MessagesApiMessage } from './messages.types.js';

/**
 * Marks the last block of history as a cache breakpoint, so the cached prefix ends before the
 * notices `withNotices` adds after it. The notices change every turn and are gone from the next
 * request: a cache entry that ended on one could never be reused. A copy; `messages` is left as
 * it was. Thinking blocks can't carry the marker, so it goes on the last block of the final
 * message that can; a final message of nothing but thinking is left unmarked.
 */
export function withCacheBreakpoint(messages: MessagesApiMessage[]): MessagesApiMessage[] {
  const last = messages.at(-1);

  if (!last) return messages;

  const index = last.content.findLastIndex(
    (block) => block.type !== 'thinking' && block.type !== 'redacted_thinking',
  );

  if (index === -1) return messages;

  return [
    ...messages.slice(0, -1),
    {
      ...last,
      content: last.content.map((block, at) =>
        at === index ? { ...block, cache_control: PROMPT_CACHE_CONTROL } : block,
      ),
    },
  ];
}
