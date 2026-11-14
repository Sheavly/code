import { describe, expect, it } from 'vitest';
import { sessionUpdateSchema } from '../session.validator.js';

const SESSION = {
  id: 'child',
  parentId: 'main',
  startedByCall: 'start-call',
  rootId: 'main',
  depth: 2,
  title: 'Update ESLint rules',
  state: 'running',
  startedAt: 1,
};
const MAIN = { id: 'main', rootId: 'main', depth: 1, title: 'Chat', state: 'idle', startedAt: 0 };

describe('sessionUpdateSchema', () => {
  it('accepts every update kind', () => {
    const updates = [
      { type: 'session_started', session: SESSION },
      { type: 'session_status', session: { ...SESSION, status: 'editing core' } },
      {
        type: 'session_message',
        session: SESSION,
        message: { from: 'main', content: 'skip tests', sentAt: 2 },
      },
      { type: 'session_idle', session: { ...SESSION, state: 'idle', lastOutcome: 'completed' } },
      { type: 'session_resumed', session: { ...SESSION, lastOutcome: 'interrupted' } },
      { type: 'session_ended', session: { ...SESSION, state: 'failed', endedAt: 3 } },
      { type: 'session_released', session: { ...SESSION, state: 'completed', endedAt: 3 } },
    ];

    for (const update of updates) expect(sessionUpdateSchema.parse(update)).toEqual(update);
  });

  it('rejects a last outcome that is not how a run ends', () => {
    const idle = (lastOutcome: string) => ({
      type: 'session_idle',
      session: { ...SESSION, state: 'idle', lastOutcome },
    });

    expect(sessionUpdateSchema.safeParse(idle('max_turns')).success).toBe(true);
    expect(sessionUpdateSchema.safeParse(idle('idle')).success).toBe(false);
    expect(sessionUpdateSchema.safeParse(idle('running')).success).toBe(false);
  });

  it('rejects an unknown state and a depth below 1', () => {
    const started = (session: object) => ({ type: 'session_started', session });

    expect(sessionUpdateSchema.safeParse(started({ ...SESSION, state: 'paused' })).success).toBe(
      false,
    );
    expect(sessionUpdateSchema.safeParse(started({ ...SESSION, depth: 0 })).success).toBe(false);
  });

  it('tells the main session from a sub-agent: only a sub-agent has a parent and the call that started it', () => {
    const started = (session: object) => ({ type: 'session_started', session });
    const { startedByCall: _call, ...noCall } = SESSION;
    const { parentId: _parent, ...noParent } = SESSION;

    expect(sessionUpdateSchema.safeParse(started(MAIN)).success).toBe(true);
    expect(sessionUpdateSchema.safeParse(started(SESSION)).success).toBe(true);

    // A sub-agent floats free without its parent, or without the call that started it.
    expect(sessionUpdateSchema.safeParse(started(noCall)).success).toBe(false);
    expect(sessionUpdateSchema.safeParse(started(noParent)).success).toBe(false);
    // The main session is started by a prompt: no parent, no call, and always depth 1.
    expect(sessionUpdateSchema.safeParse(started({ ...MAIN, parentId: 'x' })).success).toBe(false);
    expect(sessionUpdateSchema.safeParse(started({ ...MAIN, depth: 2 })).success).toBe(false);
    expect(sessionUpdateSchema.safeParse(started({ ...SESSION, depth: 1 })).success).toBe(false);
  });
});
