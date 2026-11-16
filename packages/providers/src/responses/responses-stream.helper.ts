import type { StopReason, StreamEvent } from '@sheavly/core/message/message.types';
import type { TokenUsage } from '@sheavly/protocol/usage/usage.types';
import { readReply } from '../http/reply-reader.helper.js';
import { responsesEventSchema } from './responses.validator.js';
import { handleEvent } from './events.utils.js';

/** Reads one started reply, preserving its terminal status and the API's final usage. */
export function readResponsesReply(params: {
  body: ReadableStream<Uint8Array>;
  reasoningSource: string | undefined;
  signal: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  let stopReason: StopReason = 'end_turn';
  let usage: TokenUsage | undefined;

  return readReply({
    body: params.body,
    signal: params.signal,
    protocol: {
      cutOffMessage: 'Responses stream ended before response.completed',
      parse: (raw) => {
        const parsed = responsesEventSchema.safeParse(raw);

        return parsed.success ? parsed.data : undefined; // an event type we don't use
      },
      step: (event) => {
        const step = handleEvent({ event, reasoningSource: params.reasoningSource });

        if (step.stopReason) stopReason = step.stopReason;
        if (step.usage) usage = step.usage;

        return { ...(step.events && { events: step.events }), ...(step.ended && { ended: true }) };
      },
      finish: () => [{ type: 'done', stopReason, ...(usage && { usage: { tokens: usage } }) }],
    },
  });
}
