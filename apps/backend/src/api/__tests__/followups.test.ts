import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEntries } from '@sheavly/client/client/entries.helper';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import {
  conversationIdSchema,
  messagesResponseSchema,
} from '@sheavly/protocol/server/server.validator';
import { blockTool } from '@sheavly/runtime/testing/block-tool.fake';
import { toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { reply, testApi } from '../../testing/api.fake.js';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const parts = [{ type: 'skill', name: 'review' }];
const calls = (name: string) => () => [
  toolCall({ id: 'c1', name, input: {} }),
  { type: 'done' as const, stopReason: 'tool_use' as const },
];

async function followup(params: { api: ReturnType<typeof testApi>; id: string; body: unknown }) {
  return params.api.request(`/conversations/${params.id}/followups`, {
    method: 'POST',
    body: params.body,
  });
}

afterEach(() => vi.restoreAllMocks());

describe('followups over HTTP', () => {
  it.each([
    { body: { text: 'also check this' }, content: 'also check this' },
    { body: { parts }, content: '[review]' },
  ])('delivers an accepted $body through the actual active run', async (test) => {
    const seen: ProviderRequest[] = [];
    const api = testApi({
      go: [
        calls('ask'),
        (request) => {
          seen.push(request);

          return reply('done')(request);
        },
      ],
    });
    const id = await api.start();
    const stream = await api.request(`/conversations/${id}/stream`, {
      method: 'QUERY',
      body: { approvals: true },
    });
    const prompted = await api.request(`/conversations/${id}/prompts`, {
      method: 'POST',
      body: { text: 'go' },
    });
    let accepted = false;
    let received = false;
    let done = 0;

    try {
      for await (const { entry } of readEntries(stream.body)) {
        if (entry.kind === 'approval' && entry.update.type === 'approval_requested') {
          const unknownSkill = await followup({
            api,
            id,
            body: { parts: [{ type: 'skill', name: 'nope' }] },
          });

          expect(unknownSkill.status).toBe(422);
          expect(await unknownSkill.json()).toMatchObject({ error: { code: 'unknown_skill' } });
          const response = await followup({ api, id, body: test.body });

          expect(response.status).toBe(200);
          expect(response.headers.get('content-type')).toMatch(/application\/json/);
          expect(await response.json()).toEqual({ accepted: true });
          accepted = true;
          await api.request(`/conversations/${id}/approvals/${entry.update.request.id}`, {
            method: 'POST',
            body: { response: { decision: 'skip' } },
          });
        }

        if (entry.kind === 'event' && entry.event.type === 'message_received') {
          expect(entry.event.message).toMatchObject({ from: 'user', content: test.content });
          received = true;
        }

        if (entry.kind === 'event' && entry.event.type === 'done') {
          done += 1;
          break;
        }
      }

      expect(accepted).toBe(true);
      expect(received).toBe(true);
      expect(done).toBe(1);
      expect(
        seen.some((request) =>
          request.messages.some(
            (message) => message.role === 'user' && message.content === test.content,
          ),
        ),
      ).toBe(true);
      const history = messagesResponseSchema.parse(
        await (await api.request(`/conversations/${id}/messages`)).json(),
      );

      expect(history.messages).toContainEqual(
        expect.objectContaining({ role: 'user', content: test.content }),
      );
      expect(await (await followup({ api, id, body: { text: 'after' } })).json()).toEqual({
        accepted: false,
      });
      await prompted.text();
    } finally {
      await api.conversations.closeAll();
    }
  });

  it('returns false while idle without starting a run or changing history', async () => {
    const api = testApi({});
    const id = await api.start();
    const before = await (await api.request(`/conversations/${id}/messages`)).json();

    try {
      const response = await followup({ api, id, body: { text: 'not a new prompt' } });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ accepted: false });
      expect(await (await api.request(`/conversations/${id}/messages`)).json()).toEqual(before);
      expect(api.conversations.list()).toMatchObject([{ id, running: false }]);
    } finally {
      await api.conversations.closeAll();
    }
  });

  it('returns false after stop while the active run is still cleaning up', async () => {
    const started = Promise.withResolvers<undefined>();
    const aborted = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();

    // Hold cleanup after abort so this cannot accidentally test the already-idle case.
    vi.spyOn(blockTool, 'execute').mockImplementation(async ({ signal }) => {
      signal.addEventListener('abort', () => aborted.resolve(undefined), { once: true });
      started.resolve(undefined);
      await aborted.promise;
      await release.promise;

      return 'stopped';
    });
    const api = testApi({ wait: [calls('block')] });
    const id = await api.start();
    const prompted = await api.request(`/conversations/${id}/prompts`, {
      method: 'POST',
      body: { text: 'wait' },
    });

    try {
      await started.promise;
      expect((await api.request(`/conversations/${id}/stop`, { method: 'POST' })).status).toBe(204);
      await aborted.promise;
      expect(api.conversations.get(conversationIdSchema.parse(id)).conversation.running).toBe(true);
      const response = await followup({ api, id, body: { text: 'too late' } });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ accepted: false });
      release.resolve(undefined);
      await prompted.text();
      const history = messagesResponseSchema.parse(
        await (await api.request(`/conversations/${id}/messages`)).json(),
      );

      expect(history.messages).not.toContainEqual(
        expect.objectContaining({ role: 'user', content: 'too late' }),
      );
    } finally {
      release.resolve(undefined);
      await api.conversations.closeAll();
    }
  });

  it('rejects bad bodies and unknown conversation ids with ordinary JSON errors', async () => {
    const api = testApi({});
    const id = await api.start();

    try {
      for (const body of [{}, { text: '' }, { text: 1 }, { parts: [] }, { text: 'both', parts }]) {
        const response = await followup({ api, id, body });

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: 'bad_request' } });
      }

      for (const missing of [UNKNOWN_ID, 'nope']) {
        const response = await followup({ api, id: missing, body: { text: 'hi' } });

        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
      }
    } finally {
      await api.conversations.closeAll();
    }
  });
});
