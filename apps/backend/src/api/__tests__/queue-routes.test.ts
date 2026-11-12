import { describe, expect, it } from 'vitest';
import { MemoryConversationStore } from '@sheavly/testing/store/memory-store.fake';
import { readHistoryEntries } from '@sheavly/core/store/history-log.helper';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { reply, testApi } from '../../testing/api.fake.js';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('the queue of a conversation over HTTP', () => {
  it('starts empty, keeps what is put, and replaces it whole', async () => {
    const { request, start } = testApi({ hi: [reply('hello')] });
    const id = await start();
    const read = async () =>
      ((await (await request(`/conversations/${id}/queue`)).json()) as { queued: string[] }).queued;

    expect(await read()).toEqual([]);

    const put = await request(`/conversations/${id}/queue`, {
      method: 'PUT',
      body: { queued: ['one', 'two'] },
    });

    expect(put.status).toBe(204);
    expect(await read()).toEqual(['one', 'two']);

    await request(`/conversations/${id}/queue`, { method: 'PUT', body: { queued: ['three'] } });
    expect(await read()).toEqual(['three']);
  });

  it('refuses an empty line or a body that is not a list of lines', async () => {
    const { request, start } = testApi({ hi: [reply('hello')] });
    const id = await start();

    for (const queued of [[''], 'text', [1], ['x'.repeat(20_001)]]) {
      const response = await request(`/conversations/${id}/queue`, {
        method: 'PUT',
        body: { queued },
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('answers not found for a conversation nobody has', async () => {
    const { request } = testApi({ hi: [reply('hello')] });

    expect((await request(`/conversations/${UNKNOWN_ID}/queue`)).status).toBe(404);
  });

  it('keeps the queue out of the history, and a reopened conversation does not send it', async () => {
    const store = new MemoryConversationStore();
    const first = testApi({ hi: [reply('hello')] }, store);
    const id = conversationIdSchema.parse(await first.start());

    await first.request(`/conversations/${id}/queue`, {
      method: 'PUT',
      body: { queued: ['later'] },
    });
    await first.conversations.close(id);

    const second = testApi({ hi: [reply('again')] }, store);

    await second.conversations.reopen(id);

    const queued = (await (await second.request(`/conversations/${id}/queue`)).json()) as {
      queued: string[];
    };
    const history = await readHistoryEntries(store.history({ id }));

    // Kept across the restart, shown as waiting, and in no message the model could be sent.
    expect(queued.queued).toEqual(['later']);
    expect(JSON.stringify(history)).not.toContain('later');
    expect(second.conversations.get(id).conversation.running).toBe(false);
  });
});
