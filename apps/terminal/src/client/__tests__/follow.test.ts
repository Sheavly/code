import { describe, expect, it } from 'vitest';
import type { ReconnectPolicy } from '@sheavly/client/client/client.types';
import { sseBody } from '@sheavly/client/testing/sse-body.fake';
import { LAST_EVENT_ID_HEADER } from '@sheavly/protocol/api/api.constants';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { RemoteConversation } from '../conversation.service.js';

const ID = conversationIdSchema.parse('00000000-0000-4000-8000-000000000001');
const MAIN = sessionIdSchema.parse('main');

const text = (seq: number, value: string): StreamEntry => ({
  seq,
  at: 0,
  sessionId: MAIN,
  kind: 'event',
  event: { seq, type: 'text_delta', text: value },
});

/**
 * A conversation whose live stream answers with `streams` in turn, each a real SSE body that can
 * drop mid-way (the fake server's own streams cannot: erroring one discards what it queued).
 */
async function open(params: {
  streams: ReadableStream<Uint8Array>[];
  reconnect: ReconnectPolicy;
  opened?: number[];
}) {
  const { streams, reconnect, opened = [] } = params;
  const fetch: typeof globalThis.fetch = (_input, init) => {
    if (init?.method !== 'QUERY') return Promise.resolve(Response.json({ id: ID }));

    opened.push(Number(new Headers(init.headers).get(LAST_EVENT_ID_HEADER) ?? -1));

    return Promise.resolve(new Response(streams.shift()));
  };

  return RemoteConversation.open({
    backend: {
      url: 'http://backend.test',
      token: 't',
      stop: async () => undefined,
      fetch,
      reconnect,
    },
  });
}

/** Follows the live stream, whose end is the lost stream, and gives that end. */
async function followUntilLost(conversation: RemoteConversation) {
  const { ended } = await conversation.follow({
    onEntry: () => undefined,
    signal: new AbortController().signal,
  });

  return ended;
}

describe('following the live stream', () => {
  it('reopens it after a drop and shows each entry once, in order', async () => {
    const opened: number[] = [];
    const conversation = await open({
      opened,
      reconnect: { wait: () => Promise.resolve() },
      streams: [
        sseBody({ entries: [text(0, 'one'), text(1, 'two')], dropWith: new TypeError('dropped') }),
        sseBody({ entries: [text(1, 'two'), text(2, 'three')] }),
      ],
    });
    const seen: number[] = [];
    const stop = new AbortController();
    const { ended } = await conversation.follow({
      onEntry: (entry) => {
        seen.push(entry.seq);
        if (entry.seq === 2) stop.abort();
      },
      signal: stop.signal,
    });

    await ended;

    expect(seen).toEqual([0, 1, 2]);
    // The second connection asks to resume after the last entry the first delivered.
    expect(opened).toEqual([-1, 1]);
  });

  it('rejects with a typed lost error, saying where it stopped, once it gives up', async () => {
    const conversation = await open({
      reconnect: { attempts: 0 },
      streams: [sseBody({ entries: [text(0, 'one')], dropWith: new TypeError('dropped') })],
    });

    await expect(followUntilLost(conversation)).rejects.toMatchObject({
      name: 'StreamLostError',
      lastEventId: 0,
    });
  });

  it('takes a stream the backend closed for a drop, since a conversation’s stream never ends', async () => {
    const conversation = await open({
      reconnect: { attempts: 0 },
      streams: [sseBody({ entries: [] })],
    });

    await expect(followUntilLost(conversation)).rejects.toMatchObject({ name: 'StreamLostError' });
  });
});
