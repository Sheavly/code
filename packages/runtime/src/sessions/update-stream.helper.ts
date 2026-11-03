import type { SessionRegistry } from './sessions.service.js';
import { toServerSentEvent } from './sessions.utils.js';
import type { SessionUpdate } from '@sheavly/protocol/session/session.types';

/**
 * A registry's session updates as server-sent events (`text/event-stream`): every known session
 * first (so a late UI catches up), then live until `signal` aborts or the reader cancels.
 */
export function updateStream(params: {
  sessions: SessionRegistry;
  signal?: AbortSignal;
}): ReadableStream<Uint8Array> {
  const { sessions, signal } = params;
  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => undefined;

  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      const send = (update: SessionUpdate) =>
        controller.enqueue(encoder.encode(toServerSentEvent(update)));

      for (const session of sessions.list()) send({ type: 'session_started', session });
      unsubscribe = sessions.subscribe(send);
      signal?.addEventListener(
        'abort',
        () => {
          unsubscribe();
          controller.close();
        },
        { once: true },
      );
    },
    cancel: () => {
      unsubscribe();
    },
  });
}
