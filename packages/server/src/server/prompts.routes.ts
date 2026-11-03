import { Hono } from 'hono';
import type { Conversations } from '@sheavly/host/conversations/conversations.service';
import {
  conversationIdSchema,
  sendPromptRequestSchema,
} from '@sheavly/protocol/server/server.validator';
import { streamEntries } from './sse.helper.js';
import { validJson } from './server.validator.js';

/**
 * `POST /:id/prompts`: sends the next prompt and answers with its entries as server-sent events,
 * the same `entry` frames the stream sends, ending with the main session's `done`. A prompt that
 * can't start (`session_running`, `unknown_skill`) is refused before the stream opens. The prompt
 * runs to its end whether the client stays or not: leaving only stops this response.
 */
export function promptRoutes(conversations: Conversations) {
  return new Hono().post('/:id/prompts', validJson(sendPromptRequestSchema), async (c) => {
    const id = conversationIdSchema.parse(c.req.param('id'));
    const live = conversations.get(id);
    const { mainSession, sessions } = live.harness;
    // Sending resumes the session at once (its `session_resumed`); the response opens later, so
    // the first entry the prompt makes is recorded here and the response replays from it.
    let first: number | undefined;
    const stopRecording = sessions.subscribeEntries((entry) => (first ??= entry.seq));
    let sent: Awaited<ReturnType<Conversations['send']>>;

    try {
      // Validates and prepares it (skills), so a refusal is an error response, not a stream.
      sent = await conversations.send({ id, prompt: c.req.valid('json') });
    } finally {
      stopRecording();
    }

    return streamEntries({
      c,
      live,
      filter: { replay: first !== undefined },
      lastEventId: first === undefined ? undefined : first - 1,
      isLast: (entry) =>
        entry.kind === 'event' && entry.sessionId === mainSession.id && entry.event.type === 'done',
      // The run starts once the stream is listening, so none of its entries is missed; it is
      // driven here rather than by the response, so a client leaving doesn't stop it.
      onOpen: () => void drain(sent.events),
    });
  });
}

/** Runs a prompt to its end: its events reach clients through the combined stream. */
async function drain(events: AsyncIterable<unknown>): Promise<void> {
  for await (const _event of events);
}
