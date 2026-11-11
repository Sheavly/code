import { describe, expect, it } from 'vitest';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { say, scriptedConversations as setup } from '../../testing/conversations.fake.js';

const blocked = [
  toolCall({ id: 'b1', name: 'block', input: {} }),
  { type: 'done' as const, stopReason: 'tool_use' as const },
];

describe('conversation yieldPrompt', () => {
  it('refuses when idle and once closed', async () => {
    const { conversations } = setup({ replies: [say('ok')] });
    const id = await conversations.start();
    const { conversation } = conversations.get(id);

    expect(conversation.yieldPrompt()).toBe(false);
    await conversations.close(id);
    expect(() => conversation.yieldPrompt()).toThrow(
      expect.objectContaining({ reason: 'session_ended' }),
    );
  });

  it('is accepted by a running prompt, which still completes with its own history only', async () => {
    const { conversations } = setup({ replies: [say('done')] });
    const id = await conversations.start();
    const { conversation } = conversations.get(id);
    const sent = await conversations.send({ id, prompt: { text: 'first' } });

    expect(conversation.yieldPrompt()).toBe(true);
    const events = await collect(sent.events);

    expect(events.find((event) => event.type === 'done')).toMatchObject({ reason: 'completed' });
    expect(conversation.messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
      'first',
    ]);
    // A later prompt is not yielding already.
    expect(conversation.yieldPrompt()).toBe(false);
    await conversations.close(id);
  });

  it('does not stop a prompt that is stopping', async () => {
    const { conversations } = setup({ replies: [blocked] });
    const id = await conversations.start();
    const { conversation } = conversations.get(id);
    const sent = await conversations.send({ id, prompt: { text: 'wait' } });

    for await (const event of sent.events) {
      if (event.type !== 'tool_call_started') continue;
      conversations.stop(id);
      expect(conversation.yieldPrompt()).toBe(false);
    }

    await conversations.close(id);
  });
});
