import { describe, expect, it } from 'vitest';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { say, scriptedConversations } from '../../testing/conversations.fake.js';
import type { ConversationSkills } from '../conversations.types.js';

// Flow rule 8 and the stop path: a stop while a skill is still being prepared must reach the
// prompt, which then ends as interrupted instead of running.

/** A conversation whose skills hold every prompt in preparation until `release` is called. */
async function conversationPreparing() {
  const prepared = Promise.withResolvers<undefined>();
  const skills: ConversationSkills = {
    list: async () => [],
    prepare: async ({ prompt }) => {
      await prepared.promise;

      return { text: 'text' in prompt ? prompt.text : '' };
    },
  };
  const { conversations } = scriptedConversations({ replies: [say('ran to the end')], skills });
  const id = await conversations.start();

  return { conversations, id, release: () => prepared.resolve(undefined) };
}

/** How the prompt that was sent first ended, once preparing was released. */
async function endOf(first: ReturnType<typeof sendOne>) {
  const emitted = await collect((await first).events);

  return emitted.find((event) => event.type === 'done');
}

function sendOne(params: Awaited<ReturnType<typeof conversationPreparing>>, text: string) {
  return params.conversations.send({ id: params.id, prompt: { text } });
}

describe('stopping a prompt that is still being prepared', () => {
  it('ends the prompt as interrupted instead of letting it run', async () => {
    const preparing = await conversationPreparing();
    const sending = sendOne(preparing, 'go');

    preparing.conversations.stop(preparing.id);
    preparing.release();

    expect(await endOf(sending)).toMatchObject({ reason: 'interrupted' });
  });

  it('refuses a second send meanwhile, and a stop still reaches the first', async () => {
    const preparing = await conversationPreparing();
    const first = sendOne(preparing, 'one');

    await expect(sendOne(preparing, 'two')).rejects.toMatchObject({ reason: 'session_running' });
    preparing.conversations.stop(preparing.id);
    preparing.release();

    expect(await endOf(first)).toMatchObject({ reason: 'interrupted' });
  });

  it('lets the next prompt run once a refused send was cleaned up', async () => {
    const { conversations } = scriptedConversations({ replies: [say('one'), say('two')] });
    const id = await conversations.start();
    const { events } = await conversations.send({ id, prompt: { text: 'one' } });

    await expect(conversations.send({ id, prompt: { text: 'again' } })).rejects.toMatchObject({
      reason: 'session_running',
    });
    await collect(events);

    const next = await conversations.send({ id, prompt: { text: 'two' } });

    expect((await collect(next.events)).find((event) => event.type === 'done')).toMatchObject({
      reason: 'completed',
    });
  });
});
