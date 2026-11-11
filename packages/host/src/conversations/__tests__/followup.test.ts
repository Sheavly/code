import { describe, expect, it } from 'vitest';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { MemoryConversationStore } from '@sheavly/testing/store/memory-store.fake';
import type { PreparedPrompt } from '../conversations.types.js';
import { say, scriptedConversations as setup } from '../../testing/conversations.fake.js';

/** Pauses only follow-up preparation, after a normal prompt has already started. */
function delayPreparation(live: ReturnType<ReturnType<typeof setup>['conversations']['get']>) {
  const prepared = Promise.withResolvers<PreparedPrompt>();

  live.skills = { list: async () => [], prepare: async () => prepared.promise };

  return prepared;
}

describe('prepared conversation follow-ups', () => {
  it('expands mentioned and picked skills through the same preparation as send', async () => {
    const { conversations, sent } = setup({ replies: [say('ok')], withSkills: true });
    const id = await conversations.start();
    const initial = await conversations.send({ id, prompt: { text: 'first' } });

    try {
      expect(await conversations.followup({ id, prompt: { text: 'look /review' } })).toBe(true);
      expect(
        await conversations.followup({
          id,
          prompt: { parts: [{ type: 'skill', name: 'review' }] },
        }),
      ).toBe(true);
      await collect(initial.events);
      expect(sent[0]?.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
        'first',
        '[review]\nlook /review',
        '[review]',
      ]);
      expect(
        conversations
          .messages(id)
          .filter((m) => m.role === 'user')
          .map((m) => m.content),
      ).toEqual(['first', '[review]\nlook /review', '[review]']);
    } finally {
      await conversations.close(id);
    }
  });

  it('refuses unknown picked skills without enqueuing steering', async () => {
    const { conversations } = setup({ replies: [say('ok')], withSkills: true });
    const id = await conversations.start();
    const initial = await conversations.send({ id, prompt: { text: 'first' } });

    await expect(
      conversations.followup({ id, prompt: { parts: [{ type: 'skill', name: 'missing' }] } }),
    ).rejects.toMatchObject({ reason: 'unknown_skill' });
    const { harness } = conversations.get(id);

    expect(harness.sessions.hasMessages(harness.mainSession.id)).toBe(false);
    await collect(initial.events);
    await conversations.close(id);
  });

  it.each(['completion', 'stop', 'replacement'] as const)(
    'rechecks acceptance after skill preparation races with %s',
    async (race) => {
      const { conversations } = setup({ replies: [say('first'), say('next')] });
      const id = await conversations.start();
      const initial = await conversations.send({ id, prompt: { text: 'first' } });
      const prepared = delayPreparation(conversations.get(id));
      const followup = conversations.followup({ id, prompt: { text: 'steer first' } });

      if (race === 'stop') conversations.stop(id);
      await collect(initial.events);
      let next: Awaited<ReturnType<typeof conversations.send>> | undefined;

      if (race === 'replacement') {
        // Reset preparation for the replacement prompt while the old follow-up still awaits it.
        conversations.get(id).skills = undefined;
        next = await conversations.send({ id, prompt: { text: 'next' } });
      }

      prepared.resolve({ text: 'prepared steering' });
      expect(await followup).toBe(false);
      const { harness } = conversations.get(id);

      expect(harness.sessions.hasMessages(harness.mainSession.id)).toBe(false);
      if (next) await collect(next.events);
      expect(
        conversations
          .messages(id)
          .some((m) => m.role === 'user' && m.content === 'prepared steering'),
      ).toBe(false);
      await conversations.close(id);
    },
  );

  it('rechecks storage after skill preparation instead of accepting unrecorded steering', async () => {
    const store = new MemoryConversationStore();
    const { conversations } = setup({ replies: [say('ok')], store });
    const id = await conversations.start();
    const initial = await conversations.send({ id, prompt: { text: 'first' } });
    const live = conversations.get(id);
    const prepared = delayPreparation(live);
    const followup = conversations.followup({ id, prompt: { text: 'steer' } });

    store.failWith(new Error('disk full'));
    live.harness.sessions.report({ id: live.harness.mainSession.id, status: 'working' });
    await live.harness.sessions.flushStore();
    prepared.resolve({ text: 'prepared steering' });
    await expect(followup).rejects.toMatchObject({ reason: 'storage_failed' });
    expect(live.harness.sessions.hasMessages(live.harness.mainSession.id)).toBe(false);
    await collect(initial.events);
    await conversations.close(id);
  });
});
