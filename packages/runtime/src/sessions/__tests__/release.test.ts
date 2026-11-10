import { describe, expect, it } from 'vitest';
import { SessionRegistry } from '../sessions.service.js';
import { STARTED_BY } from '../../testing/sessions.fake.js';

describe('releasing ended sessions', () => {
  it('forgets an ended session with its sub-agents and what the registry held for them', () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Chat' });
    const child = sessions.startChild({
      parentId: main.id,
      startedByCall: STARTED_BY,
      title: 'Child',
    });
    const other = sessions.startMain({ title: 'Other' });

    sessions.end({ id: child.id, state: 'completed' });
    sessions.end({ id: main.id, state: 'completed' });

    expect(sessions.release(main.id)).toBe(2);
    expect(sessions.get(main.id)).toBeUndefined();
    expect(sessions.get(child.id)).toBeUndefined();
    expect(sessions.list().map((session) => session.id)).toEqual([other.id]);
  });

  it('refuses while the session or a sub-agent under it is still open, releasing nothing', () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Chat' });
    const child = sessions.startChild({
      parentId: main.id,
      startedByCall: STARTED_BY,
      title: 'Child',
    });

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
