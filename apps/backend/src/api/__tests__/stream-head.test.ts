import { describe, expect, it } from 'vitest';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { testApi } from '../../testing/api.fake.js';

/** The first bytes a `QUERY /stream` of `body` sends, then the stream is left. */
async function firstChunk(params: {
  request: ReturnType<typeof testApi>['request'];
  id: string;
  body: unknown;
  headers?: Record<string, string>;
}) {
  const { request, id, body, headers } = params;
  const response = await request(`/conversations/${id}/stream`, {
    method: 'QUERY',
    body,
    ...(headers && { headers }),
  });
  const reader = response.body?.getReader();
  const chunk = await reader?.read();

  await reader?.cancel();

  return new TextDecoder().decode(chunk?.value as Uint8Array | undefined);
}

describe('a conversation’s live stream', () => {
  it('opens with a head frame saying where "now" is, so a client can resume after it', async () => {
    const { request, start, conversations } = testApi({});
    const id = await start();
    const { sessions } = conversations.get(conversationIdSchema.parse(id)).harness;
    const head = sessions.nextSeq() - 1;

    expect(head).toBeGreaterThanOrEqual(0);
    // An `id` and nothing else: SSE sets the last event id from it, and no entry is announced.
    expect(await firstChunk({ request, id, body: {} })).toBe(`id: ${String(head)}\n\n`);
  });

  it('sends no head frame to a stream that replays or resumes: it is told everything after an id', async () => {
    const { request, start } = testApi({});
    const id = await start();

    expect(await firstChunk({ request, id, body: { replay: true } })).toMatch(/^event: entry/);
    expect(await firstChunk({ request, id, body: {}, headers: { 'last-event-id': '0' } })).toMatch(
      /^event: entry/,
    );
  });
});
