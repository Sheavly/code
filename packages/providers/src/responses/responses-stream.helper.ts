import type { StopReason, StreamEvent } from '@sheavly/core/message/message.types';
import type { TokenUsage } from '@sheavly/protocol/usage/usage.types';
import { readServerSentEvents } from '../http/sse.utils.js';
import { ModelApiError } from '../errors/providers.errors.js';
import { responsesEventSchema } from './responses.validator.js';
import { handleEvent } from './events.utils.js';

/** Reads one started reply, preserving its terminal status and the API's final usage. */
export async function* readResponsesReply(params: {
  body: ReadableStream<Uint8Array>;
  reasoningSource: string | undefined;
  signal: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  let stopReason: StopReason = 'end_turn';
  let ended = false;
  let usage: TokenUsage | undefined;

  for await (const raw of readServerSentEvents(params.body)) {
    const parsed = responsesEventSchema.safeParse(raw);

    if (!parsed.success) continue; // an event type we don't use

    const step = handleEvent({ event: parsed.data, reasoningSource: params.reasoningSource });

    if (step.stopReason) stopReason = step.stopReason;
    if (step.ended) ended = true;
    if (step.usage) usage = step.usage;
    if (step.events) yield* step.events;
  }

  if (!ended) {
    params.signal.throwIfAborted();
    throw new ModelApiError({
      reason: 'cut_off',
      message: 'Responses stream ended before response.completed',
    });
  }

  yield { type: 'done', stopReason, ...(usage && { usage: { tokens: usage } }) };
}
