import { describe, expect, it } from 'vitest';
import { SessionRegistry } from '../sessions.service.js';
import { STARTED_BY } from '../../testing/sessions.fake.js';
import type { SessionUpdate } from '@sheavly/protocol/session/session.types';

/** A main session, and every update it makes from now on as `type:state:lastOutcome`. */
function conversation() {
  const sessions = new SessionRegistry();
  const main = sessions.startMain({ title: 'Chat' });
  const updates: string[] = [];

  sessions.subscribe((u: SessionUpdate) =>
    updates.push(`${u.type}:${u.session.state}:${u.session.lastOutcome ?? '-'}`),
  );

  return { sessions, main, updates };
}

describe('a session between prompts', () => {
  it('goes idle with how its run ended, resumes for the next prompt, and ends from idle', () => {
    const { sessions, main, updates } = conversation();

    sessions.idle({ id: main.id, outcome: 'completed' });
    sessions.resume(main.id);
    sessions.idle({ id: main.id, outcome: 'interrupted' });
    sessions.end({ id: main.id, state: 'completed' });

    expect(updates).toEqual([
      'session_idle:idle:completed',
      'session_resumed:running:completed',
      'session_idle:idle:interrupted',
      'session_ended:completed:completed',
    ]);
    expect(sessions.get(main.id)?.endedAt).toBeTypeOf('number');
  });

  it('refuses the next prompt while one runs, or once ended, saying which', () => {
    const { sessions, main } = conversation();

    expect(() => sessions.resume(main.id)).toThrow(
      expect.objectContaining({ reason: 'session_running' }),
    );
    sessions.end({ id: main.id, state: 'completed' });
    expect(() => sessions.resume(main.id)).toThrow(
      expect.objectContaining({ reason: 'session_ended' }),
    );
  });

  it('keeps sub-agents, status reports and messages working while idle where they should', () => {
    const { sessions, main } = conversation();

    sessions.idle({ id: main.id, outcome: 'completed' });
    sessions.report({ id: main.id, status: 'ignored while idle' });
    sessions.send({ id: main.id, content: 'next time', from: 'user' });

    expect(sessions.get(main.id)?.status).toBeUndefined();
    expect(sessions.takeMessages(main.id).map((m) => m.content)).toEqual(['next time']);
    expect(() =>
      sessions.startChild({ parentId: main.id, startedByCall: STARTED_BY, title: 'Late' }),
    ).toThrow('is idle between prompts');
  });

  it('ignores idle for a session that is not running', () => {
    const { sessions, main, updates } = conversation();

    sessions.end({ id: main.id, state: 'failed' });
    sessions.idle({ id: main.id, outcome: 'completed' });

    expect(updates).toEqual(['session_ended:failed:failed']);
  });
});
