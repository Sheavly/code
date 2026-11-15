import { describe, expect, it, vi } from 'vitest';
import type { TurnOutcome } from '../chat.types.js';
import type { ChatConversation } from '../chat.types.js';
import { doneEntry, quietChat } from '../testing/chat-session.fake.js';

/** A chat whose first prompt waits on `release`, and whose yield request is never answered. */
function chatWithUnansweredYield() {
  const release = Promise.withResolvers<undefined>();
  const sent: string[] = [];
  const ends: TurnOutcome[] = [];
  const reached: string[] = [];
  const conversation = {
    runningTasks: 0,
    yieldPrompt: () => new Promise<boolean>(() => undefined),
    skills: () => Promise.resolve([]),
    async *send(params: { text: string }) {
      reached.push(params.text);
      await release.promise;
      yield doneEntry();
    },
  } as unknown as ChatConversation;
  const session = quietChat({
    conversation,
    onSend: (text) => sent.push(text),
    onTurnEnd: (outcome) => ends.push(outcome),
  });

  return { session, release, sent, ends, reached };
}

describe('ChatSession: stopping a prompt that has not started', () => {
  it('ends it as interrupted without showing a message that was never sent', async () => {
    const { session, release, sent, ends, reached } = chatWithUnansweredYield();

    session.submit('one');
    await vi.waitFor(() => expect(reached).toEqual(['one']));
    session.submit('two');
    release.resolve(undefined);
    // 'two' has left the queue once it is waiting on the first prompt's unanswered yield.
    await vi.waitFor(() => expect(session.queued).toEqual([]));
    session.stop();
    await session.idle();

    expect(ends).toEqual(['completed', 'interrupted']);
    expect(reached).toEqual(['one']);
    expect(sent).toEqual(['one']);
  });
});
