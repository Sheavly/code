import { getEventListeners } from 'node:events';
import { describe, expect, it } from 'vitest';
import { SessionRegistry } from '../sessions.service.js';
import { STARTED_BY } from '../../testing/sessions.fake.js';

/** A registry with a main session and one sub-agent under it, both still running. */
function mainWithChild() {
  const sessions = new SessionRegistry();
  const main = sessions.startMain({ title: 'Chat' });
  const child = sessions.startChild({
    parentId: main.id,
    startedByCall: STARTED_BY,
    title: 'Child',
  });

  return { sessions, main, child };
}

describe('waiting on an inbox', () => {
  it('drops a wait whose signal aborts, and still wakes the others', async () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Chat' });
    const controller = new AbortController();
    const woken: string[] = [];
    const given = sessions
      .nextMessage(main.id, controller.signal)
      .then(() => woken.push('gave up'));
    const kept = sessions.nextMessage(main.id).then(() => woken.push('kept'));

    expect(sessions.inboxWaiters(main.id)).toBe(2);

    controller.abort();
    await given;

    expect(sessions.inboxWaiters(main.id)).toBe(1);

    sessions.send({ id: main.id, content: 'hi', from: 'user' });
    await kept;

    expect(woken).toEqual(['gave up', 'kept']);
    expect(sessions.inboxWaiters(main.id)).toBe(0);
  });
});

describe('an inbox wait on a long-lived signal', () => {
  it('leaves no abort listener once a message wakes it, and ignores a signal already aborted', async () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Chat' });
    const signal = new AbortController().signal;

    for (let i = 0; i < 5; i++) {
      const wait = sessions.nextMessage(main.id, signal);

      sessions.send({ id: main.id, content: 'hi', from: 'user' });
      await wait;
    }

    expect(getEventListeners(signal, 'abort')).toHaveLength(0);

    const aborted = AbortSignal.abort();

    await sessions.nextMessage(main.id, aborted);

    expect(sessions.inboxWaiters(main.id)).toBe(0);
  });
});

describe('releasing ended sessions', () => {
  it('forgets an ended session with its sub-agents and what the registry held for them', () => {
    const { sessions, main, child } = mainWithChild();
    const other = sessions.startMain({ title: 'Other' });

    sessions.end({ id: child.id, state: 'completed' });
    sessions.end({ id: main.id, state: 'completed' });

    expect(sessions.release(main.id)).toBe(2);
    expect(sessions.get(main.id)).toBeUndefined();
    expect(sessions.get(child.id)).toBeUndefined();
    expect(sessions.list().map((session) => session.id)).toEqual([other.id]);
  });

  it('refuses while the session or a sub-agent under it is still open, releasing nothing', () => {
    const { sessions, main, child } = mainWithChild();

    sessions.end({ id: main.id, state: 'completed' });

    expect(() => sessions.release(main.id)).toThrow(
      expect.objectContaining({ reason: 'session_running', sessionId: child.id }),
    );
    expect(sessions.list()).toHaveLength(2);
  });

  it('refuses an unknown session, and a released one is unknown afterwards', () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Chat' });

    sessions.end({ id: main.id, state: 'completed' });
    sessions.release(main.id);

    expect(() => sessions.release(main.id)).toThrow(
      expect.objectContaining({ reason: 'unknown_session' }),
    );
  });
});
