import type { StreamEvent } from '@sheavly/core/message/message.types';
import { providerErrorText } from '@sheavly/core/text/diagnostic-text.utils';
import { ModelApiError } from '../errors/providers.errors.js';
import { readReply } from '../http/reply-reader.helper.js';
import { ChatReply } from '../chat-reply/reply.service.js';
import { chatStreamEventSchema } from './chat-completions.validator.js';

/** A payload that carries a field this protocol reads, so a parse failure is malformed, not unknown. */
function isKnownPayload(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && ('choices' in raw || 'error' in raw);
}

/** Finish markers release complete calls; EOF without one is a cut-off reply, never success. */
export function readChatReply(params: {
  body: ReadableStream<Uint8Array>;
  source: string;
  replayReasoning: boolean;
  signal: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const reply = new ChatReply();

  return readReply({
    body: params.body,
    signal: params.signal,
    protocol: {
      cutOffMessage: 'Chat Completions stream ended before a finish reason',
      parse: (raw) => {
        const parsed = chatStreamEventSchema.safeParse(raw);

        if (parsed.success) return parsed.data;

        // An event this protocol does not use is skipped; a known one that is malformed fails.
        if (!isKnownPayload(raw)) return undefined;

        throw new ModelApiError({
          reason: 'bad_payload',
          message: 'Invalid Chat Completions stream payload',
        });
      },
      step: (event) => {
        if ('error' in event) {
          throw new ModelApiError({
            reason: 'stream_error',
            message: `Chat Completions stream error: ${providerErrorText(event.error.message ?? 'unknown error')}`,
          });
        }

        return { events: reply.keepChunk(event), ...(reply.finished && { ended: true }) };
      },
      finish: () => reply.finish(params),
    },
  });
}
