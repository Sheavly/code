import { describe, expect, it } from 'vitest';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { say, scriptedConversations } from '../../testing/conversations.fake.js';
import type { ConversationSkills } from '../conversations.types.js';

// Reproduction, flow rule 8 and the stop path: `stop` only reaches a prompt that is past
// `preparePrompt`, so a stop while a skill is still being prepared is ignored and the prompt runs
// to its end. The fixing change flips `it.fails` to `it`.

/** Sends a prompt, stops it while its skills are still being prepared, and returns how it ended. */
async function stopWhilePreparing() {
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
  const sending = conversations.send({ id, prompt: { text: 'go' } });

  conversations.stop(id);
  prepared.resolve(undefined);
  const { events } = await sending;
  const emitted = await collect(events);

  return emitted.find((event) => event.type === 'done');
}

describe('stopping a prompt that is still being prepared', () => {
  it('pinned today: the stop is ignored and the prompt runs to completed', async () => {
    expect(await stopWhilePreparing()).toMatchObject({ reason: 'completed' });
  });

  it.fails('ends the prompt as interrupted instead of letting it run', async () => {
    expect(await stopWhilePreparing()).toMatchObject({ reason: 'interrupted' });
  });
});
