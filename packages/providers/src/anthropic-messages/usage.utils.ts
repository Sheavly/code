import type { TokenUsage } from '@sheavly/protocol/usage/usage.types';
import type { MessagesEvent } from './messages.types.js';

/** Message deltas are cumulative snapshots, not token increments. Anthropic cache tokens are extra input. */
export function messageUsage(params: {
  event: MessagesEvent;
  previous: TokenUsage | undefined;
}): TokenUsage | undefined {
  const { event, previous } = params;
  const raw = event.type === 'message_start' ? event.message.usage : undefined;

  if (raw) {
    const cacheReadTokens = raw.cache_read_input_tokens ?? 0;
    const cacheWriteTokens = raw.cache_creation_input_tokens ?? 0;

    return {
      inputTokens: raw.input_tokens + cacheReadTokens + cacheWriteTokens,
      outputTokens: raw.output_tokens,
      cacheReadTokens,
      cacheWriteTokens,
    };
  }

  if (event.type !== 'message_delta' || !event.usage || !previous) return previous;

  const update = event.usage;
  const cacheReadTokens = update.cache_read_input_tokens ?? previous.cacheReadTokens;
  const cacheWriteTokens = update.cache_creation_input_tokens ?? previous.cacheWriteTokens;
  const uncached =
    update.input_tokens ??
    previous.inputTokens - previous.cacheReadTokens - previous.cacheWriteTokens;

  return {
    inputTokens: uncached + cacheReadTokens + cacheWriteTokens,
    outputTokens: update.output_tokens ?? previous.outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  };
}
