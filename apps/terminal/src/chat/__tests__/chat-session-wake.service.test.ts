import { describe, expect, it } from 'vitest';
import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { listeningChat, MAIN_SESSION as MAIN } from '../testing/chat-session.fake.js';

const REF = { id: MAIN, rootId: MAIN, depth: 1 } as const;

let nextSeq = 0;

const entry = (event: EntryEvent): StreamEntry => ({
  seq: nextSeq++,
  at: 0,
  sessionId: MAIN,
  kind: 'event',
  event,
});
const text = (value: string) => entry({ seq: 0, type: 'text_delta', text: value });
const done = (reason: 'completed' | 'failed' = 'completed') =>
  entry({ seq: 0, type: 'done', reason, session: REF });

function idleChat() {
  const busy: boolean[] = [];
  const session = listeningChat({ onBusy: (isBusy) => busy.push(isBusy) });

  return { session, busy };
}

// The backend starts a run itself when finite work finishes while the chat is idle, and no prompt
// of this chat carries it, so the chat tells the UI when such a run starts and ends.
describe('ChatSession: a run the backend started itself', () => {
  it('tells the UI it is busy while the run goes, and idle when it ends', () => {
    const { session, busy } = idleChat();

    session.hear(text('The task finished.'));
    expect(busy).toEqual([true]);

    session.hear(done());
    expect(busy).toEqual([true, false]);
  });

  it('tells the UI once however many entries the run writes', () => {
    const { session, busy } = idleChat();

    session.hear(text('One.'));
    session.hear(text('Two.'));
    session.hear(text('Three.'));

    expect(busy).toEqual([true]);
  });

  it('tells the UI a failed run ended, which ends with a done like every other run', () => {
    const { session, busy } = idleChat();

    session.hear(text('Starting.'));
    session.hear(done('failed'));

    expect(busy).toEqual([true, false]);
  });

  it('ignores an entry it already showed, so a replay neither restarts nor ends a run', () => {
    const { session, busy } = idleChat();
    const first = text('The task finished.');
    const last = done();

    session.hear(first);
    session.hear(last);
    session.hear(first);
    session.hear(last);

    expect(busy).toEqual([true, false]);
  });

  it('stays busy through a prompt sent during the run, and idle once, when the prompt ends', async () => {
    const release = Promise.withResolvers<undefined>();
    const busy: boolean[] = [];
    const session = listeningChat({
      onBusy: (isBusy) => busy.push(isBusy),
      async *send() {
        await release.promise;
        yield* [];
      },
    });

    session.hear(text('The task finished.'));
    session.submit('go');
    // The wake's own end arrives while the prompt runs: it must not report idle.
    session.hear(done());
    expect(busy).toEqual([true]);

    release.resolve(undefined);
    await session.idle();

    expect(busy).toEqual([true, false]);
  });

  it('stops a run the backend started, and Ctrl+C is the prompt’s once one is sent', async () => {
    const stopped: string[] = [];
    const session = listeningChat({
      async *send() {
        yield* [];
      },
      stop: () => {
        stopped.push('stop');

        return Promise.resolve();
      },
    });

    session.hear(text('The task finished.'));
    expect(session.stop()).toBe('stopped');
    expect(stopped).toEqual(['stop']);

    session.submit('go');
    await session.idle();

    expect(session.stop()).toBe('idle');
    expect(stopped).toEqual(['stop']);
  });

  it('tells the UI nothing for an idle update with no run going', () => {
    const { session, busy } = idleChat();

    session.hear({
      seq: nextSeq++,
      at: 0,
      sessionId: MAIN,
      kind: 'update',
      update: {
        type: 'session_idle',
        session: { ...REF, title: 'Main', state: 'idle', lastOutcome: 'failed', startedAt: 0 },
      },
    });

    expect(busy).toEqual([]);
  });
});
