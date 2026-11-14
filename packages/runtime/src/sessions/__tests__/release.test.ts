import { getEventListeners } from 'node:events';
import { describe, expect, it } from 'vitest';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
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

  it('refuses an unknown session, and tells a released one from it', () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Chat' });

    sessions.end({ id: main.id, state: 'completed' });
    sessions.release(main.id);

    expect(sessions.isReleased(main.id)).toBe(true);
    expect(sessions.isReleased(sessionIdSchema.parse('never'))).toBe(false);
    expect(() => sessions.release(main.id)).toThrow(
      expect.objectContaining({ reason: 'session_released' }),
    );
    expect(() => sessions.release(sessionIdSchema.parse('never'))).toThrow(
      expect.objectContaining({ reason: 'unknown_session' }),
    );
  });

  it('refuses a write to a released session as released, not as unknown', () => {
    const { sessions, child } = mainWithChild();

    sessions.end({ id: child.id, state: 'completed' });
    sessions.release(child.id);

    const writes = [
      () => sessions.report({ id: child.id, status: 'late' }),
      () =>
        sessions.setModel({
          id: child.id,
          modelId: modelIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a31'),
        }),
      () =>
        sessions.publish({
          sessionId: child.id,
          event: { seq: 0, type: 'text_delta', text: 'late' },
        }),
      () => sessions.send({ id: child.id, content: 'hi', from: 'user' }),
    ];

    for (const write of writes) {
      expect(write).toThrow(expect.objectContaining({ reason: 'session_released' }) as Error);
    }
  });

  it('announces each released session once, with its last snapshot', () => {
    const { sessions, main, child } = mainWithChild();
    const seen: string[] = [];

    sessions.subscribe((update) => {
      if (update.type === 'session_released') {
        seen.push(`${update.session.title}:${update.session.state}`);
      }
    });
    sessions.end({ id: child.id, state: 'failed' });
    sessions.release(child.id);

    expect(seen).toEqual(['Child:failed']);
    expect(sessions.get(main.id)).toBeDefined();
  });
});

describe('releasing a delivered sub-agent', () => {
  it('releases an ended sub-agent and what it started, and reports it did', () => {
    const { sessions, main, child } = mainWithChild();
    const grandchild = sessions.startChild({
      parentId: child.id,
      startedByCall: STARTED_BY,
      title: 'Grandchild',
    });

    sessions.end({ id: grandchild.id, state: 'completed' });
    sessions.end({ id: child.id, state: 'completed' });

    expect(sessions.releaseAgent(child.id)).toBe(true);
    expect(sessions.list().map((session) => session.id)).toEqual([main.id]);
    expect(sessions.isReleased(grandchild.id)).toBe(true);
  });

  it('leaves an open subtree alone instead of throwing, for a later turn', () => {
    const { sessions, child } = mainWithChild();
    const grandchild = sessions.startChild({
      parentId: child.id,
      startedByCall: STARTED_BY,
      title: 'Grandchild',
    });

    sessions.end({ id: child.id, state: 'completed' });

    expect(sessions.releaseAgent(child.id)).toBe(false);
    expect(sessions.list()).toHaveLength(3);

    sessions.end({ id: grandchild.id, state: 'completed' });

    expect(sessions.releaseAgent(child.id)).toBe(true);
  });

  it('never releases a main session, an unknown id or one already released', () => {
    const { sessions, main, child } = mainWithChild();

    sessions.end({ id: child.id, state: 'completed' });
    sessions.end({ id: main.id, state: 'completed' });
    sessions.releaseAgent(child.id);

    expect(sessions.releaseAgent(main.id)).toBe(false);
    expect(sessions.releaseAgent(child.id)).toBe(false);
    expect(sessions.releaseAgent(sessionIdSchema.parse('never'))).toBe(false);
    expect(sessions.get(main.id)).toBeDefined();
  });

  it('keeps a released sub-agent in its ancestors subtree stream, live and replayed', () => {
    const { sessions, main, child } = mainWithChild();
    const live: number[] = [];

    sessions.subscribeEntries((entry) => live.push(entry.seq), {
      sessionId: main.id,
      subtree: true,
    });
    sessions.end({ id: child.id, state: 'completed' });
    sessions.releaseAgent(child.id);

    const afterRelease = live.length;
    const replayed: string[] = [];

    sessions.subscribeEntries(
      (entry) => replayed.push(`${entry.kind}:${entry.sessionId === child.id ? 'child' : 'main'}`),
      { sessionId: main.id, subtree: true, replay: true },
    );

    expect(afterRelease).toBeGreaterThan(0);
    expect(replayed).toContain('update:child');
    expect(replayed.filter((entry) => entry.endsWith('child')).length).toBeGreaterThanOrEqual(3);
  });
});
