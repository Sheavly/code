import type { Message } from '@sheavly/protocol/message/message.types';
import { ownReplay } from '../http/replay.utils.js';
import type { ReplayDropHandler } from '../http/replay.types.js';
import { CACHE_BREAKPOINT, MAX_CACHE_BREAKPOINTS } from './responses.constants.js';

// Translation from our Message shape to Responses API input items.

/**
 * Keep the boundary before the latest tool-call turn available for lookup, even when that turn
 * adds enough parallel results to fill every write slot. Remaining slots mark the latest results.
 */
export function breakpointIndexes(messages: Message[]): Set<number> {
  const eligible = messages.flatMap((message, index) =>
    message.role === 'assistant' ? [] : [index],
  );
  const latestToolTurn = messages.findLastIndex(
    (message) => message.role === 'assistant' && message.toolCalls.length > 0,
  );
  const previousBoundary = eligible.findLast((index) => index < latestToolTurn);
  const marked = eligible.slice(-MAX_CACHE_BREAKPOINTS);

  if (previousBoundary !== undefined && !marked.includes(previousBoundary)) {
    marked[0] = previousBoundary;
  }

  return new Set(marked);
}

/** One `input_text` block; with caching on, every user and tool message is sent in this form. */
function textBlock(params: { text: string; marked: boolean }) {
  const { text, marked } = params;

  return [
    { type: 'input_text', text, ...(marked && { prompt_cache_breakpoint: CACHE_BREAKPOINT }) },
  ];
}

/**
 * `reasoningSource`: resend reasoning items produced by this backend + model; others are dropped
 * (another provider's encrypted reasoning would be rejected). Undefined = send none.
 *
 * `cache`: undefined sends plain strings. Otherwise user and tool content is sent as blocks (so a
 * message's form doesn't change when it stops being the boundary) and `marked` adds a breakpoint.
 *
 * Order within an assistant turn: reasoning → text → function calls, matching how the
 * Responses API emits them (the model reasons, then acts).
 */
export function toInputItems(params: {
  message: Message;
  reasoningSource: string | undefined;
  onReplayDropped?: ReplayDropHandler | undefined;
  cache?: { marked: boolean };
}): unknown[] {
  const { message, reasoningSource, cache } = params;
  const content = (text: string) => (cache ? textBlock({ text, marked: cache.marked }) : text);

  switch (message.role) {
    case 'user':
      return [{ role: 'user', content: content(message.content) }];
    case 'assistant':
      return [
        ...ownReplay({
          items: message.reasoning,
          source: reasoningSource,
          onDropped: params.onReplayDropped,
        }).map((item) => item.data),
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
        {
          type: 'function_call_output',
          call_id: message.toolCallId,
          output: content(message.content),
        },
      ];
  }
}
