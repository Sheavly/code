import { describe, expect, it } from 'vitest';
import { RUN_OUTCOMES } from '@sheavly/protocol/status/status.constants';
import { sessionUpdateSchema } from '@sheavly/protocol/session/session.validator';
import type { RunOutcome, SessionUpdate } from '@sheavly/protocol/session/session.types';
import { STARTED_BY } from '../../testing/sessions.fake.js';
import { SessionRegistry } from '../sessions.service.js';

/** A main session, and every update it makes from now on. */
function conversation() {
  const sessions = new SessionRegistry();
  const main = sessions.startMain({ title: 'Chat' });
  const updates: SessionUpdate[] = [];

  sessions.subscribe((update) => updates.push(update));

  return { sessions, main, updates };
}

/** Every update must survive the wire schema, which refuses a state that contradicts its fields. */
function expectConsistent(updates: readonly SessionUpdate[]) {
  for (const update of updates) {
    expect(sessionUpdateSchema.safeParse(update).success, update.type).toBe(true);
  }
}

describe('a session’s state, last outcome and end time', () => {
  it.each(RUN_OUTCOMES)(
    'parse as the registry writes them through a prompt that ends %s',
    (outcome) => {
      const idle = conversation();

      idle.sessions.idle({ id: idle.main.id, outcome });
      idle.sessions.resume(idle.main.id);
      idle.sessions.idle({ id: idle.main.id, outcome });

      expectConsistent(idle.updates);
      // Idle is open: it has an outcome and no end.
      expect(idle.sessions.get(idle.main.id)).toMatchObject({
        state: 'idle',
        lastOutcome: outcome,
      });
      expect(idle.sessions.get(idle.main.id)?.endedAt).toBeUndefined();

      idle.sessions.end({ id: idle.main.id, state: outcome });

      expectConsistent(idle.updates);
      expect(idle.sessions.get(idle.main.id)).toMatchObject({
        state: outcome,
        lastOutcome: outcome,
      });
      expect(idle.sessions.get(idle.main.id)?.endedAt).toBeTypeOf('number');
    },
  );

  it('is never left contradictory by a second ending: the first one wins whole', () => {
    const { sessions, main, updates } = conversation();

    sessions.end({ id: main.id, state: 'failed' });
    sessions.end({ id: main.id, state: 'completed' });
    sessions.idle({ id: main.id, outcome: 'completed' });

    expectConsistent(updates);
    expect(sessions.get(main.id)).toMatchObject({ state: 'failed', lastOutcome: 'failed' });
  });

  it.each(['running', 'idle'] as const)(
    'is refused by the schema when an open session (%s) carries an end time',
    (state) => {
      const { sessions, main } = conversation();
      const session = { ...sessions.get(main.id), state, endedAt: 5 };

      expect(sessionUpdateSchema.safeParse({ type: 'session_idle', session }).success).toBe(false);
    },
  );

  const PAIRS = RUN_OUTCOMES.flatMap((state) =>
    RUN_OUTCOMES.map((other) => [state, other] as const),
  );

  /** Whether the schema takes an ended main session in `state` whose last outcome is `other`. */
  function schemaTakesEnded(state: RunOutcome, other: RunOutcome): boolean {
    const { sessions, main } = conversation();
    const session = { ...sessions.get(main.id), state, lastOutcome: other, endedAt: 5 };

    return sessionUpdateSchema.safeParse({ type: 'session_ended', session }).success;
  }

  it.each(PAIRS.filter(([state, other]) => state === other))(
    'is accepted by the schema when an ended session is %s and its last outcome is %s',
    (state, other) => {
      expect(schemaTakesEnded(state, other)).toBe(true);
    },
  );

  it.each(PAIRS.filter(([state, other]) => state !== other))(
    'is refused by the schema when an ended session is %s but its last outcome is %s',
    (state, other) => {
      expect(schemaTakesEnded(state, other)).toBe(false);
    },
  );

  it('holds for a sub-agent as for the main session: it agrees as the registry writes it, and is refused when it does not', () => {
    const { sessions, main, updates } = conversation();
    const child = sessions.startChild({
      parentId: main.id,
      startedByCall: STARTED_BY,
      title: 'Reader',
    });

    sessions.end({ id: child.id, state: 'failed' });

    expectConsistent(updates);

    const contradicting = { ...sessions.get(child.id), lastOutcome: 'completed' };

    expect(
      sessionUpdateSchema.safeParse({ type: 'session_ended', session: contradicting }).success,
    ).toBe(false);
  });
});
