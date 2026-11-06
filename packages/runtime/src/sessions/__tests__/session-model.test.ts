import { describe, expect, it } from 'vitest';
import { MemoryConversationStore } from '@sheavly/testing/store/memory-store.fake';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import type { SessionRef, SessionUpdate } from '@sheavly/protocol/session/session.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { SessionError } from '../../errors/sessions.errors.js';
import { STARTED_BY } from '../../testing/sessions.fake.js';
import { SessionRegistry } from '../sessions.service.js';
import { readStoredLog } from '../stored-log.helper.js';

const ASTRA = modelIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a31');
const BORA = modelIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b72');

/** What a test works with: the registry, its main session and the sub-agent under it. */
type Run = { sessions: SessionRegistry; main: SessionRef; child: SessionRef };

/** A main session with a sub-agent, and every `session_model` update from now on. */
function agents() {
  const sessions = new SessionRegistry();
  const main = sessions.startMain({ title: 'Chat' });
  const child = sessions.startChild({
    parentId: main.id,
    startedByCall: STARTED_BY,
    title: 'Agent',
  });
  const models: { session: string; modelId: string }[] = [];

  sessions.subscribe((update: SessionUpdate) => {
    if (update.type === 'session_model') {
      models.push({ session: update.session.id, modelId: update.modelId });
    }
  });

  return { sessions, main, child, models };
}

describe('a session’s model', () => {
  it('is recorded on the session and announced, at its start and at each switch', () => {
    const { sessions, main, models } = agents();

    expect(sessions.get(main.id)?.modelId).toBeUndefined();

    sessions.setModel({ id: main.id, modelId: ASTRA });
    sessions.setModel({ id: main.id, modelId: BORA });

    expect(sessions.get(main.id)?.modelId).toBe(BORA);
    expect(models).toEqual([
      { session: main.id, modelId: ASTRA },
      { session: main.id, modelId: BORA },
    ]);
  });

  it('is one session’s: a sub-agent’s model never moves the main session’s, nor the reverse', () => {
    const { sessions, main, child, models } = agents();

    sessions.setModel({ id: main.id, modelId: ASTRA });
    sessions.setModel({ id: child.id, modelId: BORA });

    expect(sessions.get(main.id)?.modelId).toBe(ASTRA);
    expect(sessions.get(child.id)?.modelId).toBe(BORA);

    sessions.setModel({ id: main.id, modelId: BORA });

    expect(sessions.get(child.id)?.modelId).toBe(BORA);
    expect(models.map((m) => m.session)).toEqual([main.id, child.id, main.id]);
  });

  it('is not announced again when it is already that model', () => {
    const { sessions, main, models } = agents();

    sessions.setModel({ id: main.id, modelId: ASTRA });
    sessions.setModel({ id: main.id, modelId: ASTRA });

    expect(models).toHaveLength(1);
  });

  it('announces mode changes on the same model and keeps each session’s mode separate', () => {
    const { sessions, main, child, models } = agents();

    sessions.setModel({ id: main.id, modelId: ASTRA, mode: 'high' });
    sessions.setModel({ id: child.id, modelId: ASTRA, mode: 'low' });
    sessions.setModel({ id: main.id, modelId: ASTRA, mode: 'extreme' });
    sessions.setModel({ id: main.id, modelId: ASTRA, mode: 'extreme' });
    expect(models).toHaveLength(3);
    expect(sessions.get(main.id)?.mode).toBe('extreme');
    expect(sessions.get(child.id)?.mode).toBe('low');
  });

  it('can change while a session is idle between prompts, but not once it has ended', () => {
    const { sessions, main, child } = agents();

    sessions.idle({ id: main.id, outcome: 'completed' });
    sessions.setModel({ id: main.id, modelId: ASTRA });
    expect(sessions.get(main.id)?.modelId).toBe(ASTRA);

    sessions.end({ id: child.id, state: 'completed' });
    expect(() => sessions.setModel({ id: child.id, modelId: ASTRA })).toThrow(SessionError);
    expect(() => sessions.setModel({ id: child.id, modelId: ASTRA })).toThrow('has ended');
    expect(sessions.get(child.id)?.modelId).toBeUndefined();
  });

  it('refuses a session nobody started', () => {
    const { sessions } = agents();

    expect(() =>
      sessions.setModel({ id: sessionIdSchema.parse('nobody'), modelId: ASTRA }),
    ).toThrow('Unknown session nobody');
  });
});

describe('a session’s model in a stored conversation', () => {
  /** A conversation that ran `switches` (each a session and its model), then reopened. */
  async function reopenedAfter(switches: (run: Run) => void) {
    const store = new MemoryConversationStore();
    const id = conversationIdSchema.parse('00000000-0000-4000-8000-000000000001');
    const first = new SessionRegistry({ store: store.entries(id) });
    const main = first.startMain({ title: 'Chat' });
    const child = first.startChild({
      parentId: main.id,
      startedByCall: STARTED_BY,
      title: 'Agent',
    });

    switches({ sessions: first, main, child });
    await first.flushStore();

    const second = new SessionRegistry({
      store: store.entries(id),
      resume: await readStoredLog(store.entries(id)),
    });

    return { second, main, child };
  }

  it('is back after a restore: each session’s own model, the last one it was switched to', async () => {
    const { second, main, child } = await reopenedAfter(({ sessions, main, child }) => {
      sessions.setModel({ id: main.id, modelId: ASTRA });
      sessions.setModel({ id: child.id, modelId: BORA });
      // The main session switches later: its last model comes back, the child's is not touched.
      sessions.setModel({ id: main.id, modelId: BORA });
      sessions.setModel({ id: main.id, modelId: ASTRA });
    });

    expect(second.get(main.id)?.modelId).toBe(ASTRA);
    expect(second.get(child.id)?.modelId).toBe(BORA);
  });
});
