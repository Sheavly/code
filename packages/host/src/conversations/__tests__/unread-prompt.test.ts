import { describe, expect, it, vi } from 'vitest';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { say, scriptedConversations } from '../../testing/conversations.fake.js';

// One owner of "a conversation is running": the conversation. A prompt whose events nobody reads
// (the SSE callback never ran) must not leave it running once it is stopped.

describe('a prompt whose events are never read', () => {
  it('is not left running once it is stopped, and the next prompt runs', async () => {
    const { conversations } = scriptedConversations({ replies: [say('one'), say('two')] });
    const id = await conversations.start();

    await conversations.send({ id, prompt: { text: 'one' } });

    expect(conversations.list().find((summary) => summary.id === id)?.running).toBe(true);

    conversations.stop(id);

    await vi.waitFor(() => {
      expect(conversations.list().find((summary) => summary.id === id)?.running).toBe(false);
    });

    const next = await conversations.send({ id, prompt: { text: 'two' } });

    expect(await collect(next.events)).toContainEqual(
      expect.objectContaining({ type: 'done', reason: 'completed' }),
    );
  });
});
