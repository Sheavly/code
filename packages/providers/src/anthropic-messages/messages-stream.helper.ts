import type { StopReason, StreamEvent } from '@sheavly/core/message/message.types';
import type { TokenUsage } from '@sheavly/protocol/usage/usage.types';
import { doneEvent } from '../http/done-event.utils.js';
import { readReply } from '../http/reply-reader.helper.js';
import { MESSAGES_API } from './messages.constants.js';
import { createMessagesReader } from './events.utils.js';
import type { MessagesReplay } from './messages.types.js';
import { messagesEventSchema } from './messages.validator.js';
import { messageUsage } from './usage.utils.js';

/** Reads one started reply, preserving block replay and cumulative usage snapshots. */
export function readMessagesReply(params: {
  body: ReadableStream<Uint8Array>;
  reasoningSource: string | undefined;
  prefix: string;
  /** The notice blocks the request carried, kept in the reply's replay state. */
  notices: NonNullable<MessagesReplay['notices']>;
  signal: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const reader = createMessagesReader(params);
  let stopReason: StopReason = 'end_turn';
  let usage: TokenUsage | undefined;

  return readReply({
    body: params.body,
    signal: params.signal,
    protocol: {
      cutOffMessage: `${MESSAGES_API} stream ended before message_stop`,
      parse: (raw) => {
        const parsed = messagesEventSchema.safeParse(raw);

        return parsed.success ? parsed.data : undefined; // an event type we don't use
      },
      step: (event) => {
        const step = reader.read(event);

        usage = messageUsage({ event, previous: usage });
        if (step.stopReason) stopReason = step.stopReason;

        return { events: step.events, ...(step.ended && { ended: true }) };
      },
      finish: () => [doneEvent({ stopReason, usage })],
    },
  });
}
