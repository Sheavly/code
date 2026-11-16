import type { StopReason, StreamEvent } from '@sheavly/core/message/message.types';
import type { TokenUsage } from '@sheavly/protocol/usage/usage.types';

/** The `done` event that ends a reply, carrying the API's final usage only when it reported one. */
export function doneEvent(params: {
  stopReason: StopReason;
  usage: TokenUsage | undefined;
}): StreamEvent {
  const { stopReason, usage } = params;

  return { type: 'done', stopReason, ...(usage && { usage: { tokens: usage } }) };
}
