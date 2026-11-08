import type { StreamEvent } from '@sheavly/core/message/message.types';
import { ModelApiError } from '../errors/providers.errors.js';
import { readServerSentEvents } from '../http/sse.utils.js';
import { ChatReply } from '../chat-reply/reply.service.js';
import { chatStreamEventSchema } from './chat-completions.validator.js';

/** Finish markers release complete calls; EOF without one is a cut-off reply, never success. */
export async function* readChatReply(params: {
  body: ReadableStream<Uint8Array>;
  source: string;
  replayReasoning: boolean;
  signal: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const reply = new ChatReply();

  for await (const raw of readServerSentEvents(params.body)) {
    const parsed = chatStreamEventSchema.safeParse(raw);

    if (!parsed.success) {
      throw new ModelApiError({
        reason: 'bad_payload',
        message: 'Invalid Chat Completions stream payload',
      });
    }

    if ('error' in parsed.data) {
      throw new ModelApiError({
        reason: 'stream_error',
        message: 'Chat Completions returned a stream error',
      });
    }

    yield* reply.keepChunk(parsed.data);
  }

  params.signal.throwIfAborted();
  yield* reply.finish(params);
}
