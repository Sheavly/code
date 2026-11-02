import { describe, expect, it } from 'vitest';
import { sessionUpdateSchema } from '../session.validator.js';

const SESSION = {
  id: 'child',
  parentId: 'main',
  rootId: 'main',
  depth: 2,
  title: 'Update ESLint rules',
  state: 'running',
  startedAt: 1,
};

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
      { type: 'session_ended', session: { ...SESSION, state: 'failed', endedAt: 3 } },
    ];

    for (const update of updates) expect(sessionUpdateSchema.parse(update)).toEqual(update);
  });

  it('rejects an unknown state and a depth below 1', () => {
    const started = (session: object) => ({ type: 'session_started', session });

    expect(sessionUpdateSchema.safeParse(started({ ...SESSION, state: 'paused' })).success).toBe(
      false,
    );
    expect(sessionUpdateSchema.safeParse(started({ ...SESSION, depth: 0 })).success).toBe(false);
  });
});
