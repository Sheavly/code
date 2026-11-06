import type { StopReason, StreamEvent } from '@sheavly/core/message/message.types';
import type { TokenUsage } from '@sheavly/protocol/usage/usage.types';
import { readServerSentEvents } from '../http/sse.utils.js';
import { ModelApiError } from '../errors/providers.errors.js';
import { MESSAGES_API } from './messages.constants.js';
import { createMessagesReader } from './events.utils.js';
import { messagesEventSchema } from './messages.validator.js';
import { messageUsage } from './usage.utils.js';

/** Reads one started reply, preserving block replay and cumulative usage snapshots. */
export async function* readMessagesReply(params: {
  body: ReadableStream<Uint8Array>;
  reasoningSource: string | undefined;
  prefix: string;
  signal: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const reader = createMessagesReader(params);
  let stopReason: StopReason = 'end_turn';
  let ended = false;
  let usage: TokenUsage | undefined;

  for await (const raw of readServerSentEvents(params.body)) {
    const parsed = messagesEventSchema.safeParse(raw);

    if (!parsed.success) continue; // an event type we don't use

    const step = reader.read(parsed.data);

    usage = messageUsage({ event: parsed.data, previous: usage });
    if (step.stopReason) stopReason = step.stopReason;
    if (step.ended) ended = true;
    yield* step.events;
  }

  if (!ended) {
    params.signal.throwIfAborted();
    throw new ModelApiError({
      reason: 'cut_off',
      message: `${MESSAGES_API} stream ended before message_stop`,
    });
  }

  yield { type: 'done', stopReason, ...(usage && { usage: { tokens: usage } }) };
}
