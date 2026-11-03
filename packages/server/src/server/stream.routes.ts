import { Hono } from 'hono';
import type { Conversations } from '@sheavly/host/conversations/conversations.service';
import { conversationIdSchema, streamQuerySchema } from '@sheavly/protocol/server/server.validator';
import { streamEntries } from './sse.helper.js';
import { parseLastEventId } from './server.utils.js';
import { validJson } from './server.validator.js';

/**
 * `QUERY /:id/stream`: a conversation's combined stream, every prompt's entries, sub-agents and
 * approvals included, as server-sent events, for as long as the client stays. The body filters it
 * (one session, with `subtree` its sub-agents; `replay` from the start), and `Last-Event-ID`
 * resumes right after the last entry a client got. QUERY, not GET: the filter is a typed body,
 * and a client can send the token as a header (no `EventSource`, so never in a URL).
 */
export function streamRoutes(conversations: Conversations) {
  return new Hono().query('/:id/stream', validJson(streamQuerySchema), (c) => {
    const live = conversations.get(conversationIdSchema.parse(c.req.param('id')));
    const { session, subtree, replay } = c.req.valid('json');
    const lastEventId = parseLastEventId(c.req.header('last-event-id'));

    return streamEntries({
      c,
      live,
      filter: {
        ...(session !== undefined && { sessionId: session }),
        ...(subtree !== undefined && { subtree }),
        // Resuming needs the entries since the one the client got, which only replay has.
        replay: replay === true || lastEventId !== undefined,
      },
      lastEventId,
    });
  });
}
