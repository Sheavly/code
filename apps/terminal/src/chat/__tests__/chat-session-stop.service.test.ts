import { describe, expect, it, vi } from 'vitest';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { Renderer } from '../../render/render.service.js';
import { ChatSession } from '../chat-session.service.js';
import type { ChatConversation, TurnOutcome } from '../chat.types.js';

const MAIN = sessionIdSchema.parse('main');

const reply: StreamEntry = {
  seq: 0,
  at: 0,
  sessionId: MAIN,
  kind: 'event',
  event: { seq: 0, type: 'text_delta', text: 'working' },
};

const done: StreamEntry = {
  seq: 1,
  at: 0,
  sessionId: MAIN,
  kind: 'event',
  event: {
    seq: 1,
    type: 'done',
    reason: 'completed',
    session: { id: MAIN, rootId: MAIN, depth: 1 },
  },
};

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
      yield reply;
      await release.promise;
      yield done;
    },
  } as unknown as ChatConversation;
  const session = new ChatSession({
    conversation,
    renderer: new Renderer(
      () => undefined,
      () => 0,
    ),
    mainSession: MAIN,
    write: () => undefined,
    onSend: (text) => sent.push(text),
    onTurnEnd: (outcome) => ends.push(outcome),
    onExit: () => undefined,
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
