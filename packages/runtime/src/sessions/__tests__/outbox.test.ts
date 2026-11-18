import { describe, expect, it } from 'vitest';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { STARTED_BY } from '../../testing/sessions.fake.js';
import { MAX_QUEUED_NOTICES } from '../sessions.constants.js';
import { SessionRegistry } from '../sessions.service.js';
import type { QueuedNotice } from '../sessions.types.js';

const notice = (topic: string): QueuedNotice => ({
  kind: 'extension-notice',
  extension: 'notes',
  topic,
  version: 1,
  data: { n: 1 },
  text: `text of ${topic}`,
});

/** A registry with its main session and one sub-agent under it. */
function mainWithChild() {
  const sessions = new SessionRegistry();
  const main = sessions.startMain({ title: 'Main' });
  const child = sessions.startChild({
    parentId: main.id,
    startedByCall: STARTED_BY,
    title: 'Child',
  });

  return { sessions, main, child };
}

describe('SessionRegistry outbox', () => {
  it('takes queued notices once, oldest first', () => {
    const { sessions, main } = mainWithChild();

    sessions.queueNotice({ id: main.id, notice: notice('notes.a') });
    sessions.queueNotice({ id: main.id, notice: notice('notes.b') });

    expect(sessions.takeNotices(main.id).map((each) => each.topic)).toEqual(['notes.a', 'notes.b']);
    expect(sessions.takeNotices(main.id)).toEqual([]);
  });

  it('refuses a notice past the cap, keeping the queued ones in order', () => {
    const { sessions, main } = mainWithChild();

    for (let index = 0; index < MAX_QUEUED_NOTICES; index += 1) {
      sessions.queueNotice({ id: main.id, notice: notice(`notes.n${index}`) });
    }

    expect(() => sessions.queueNotice({ id: main.id, notice: notice('notes.over') })).toThrow(
      expect.objectContaining({ name: 'SessionError', reason: 'outbox_full' }),
    );

    const taken = sessions.takeNotices(main.id).map((each) => each.topic);

    expect(taken).toHaveLength(MAX_QUEUED_NOTICES);
    expect(taken[0]).toBe('notes.n0');
    expect(taken.at(-1)).toBe(`notes.n${MAX_QUEUED_NOTICES - 1}`);

    sessions.queueNotice({ id: main.id, notice: notice('notes.after-drain') });

    expect(sessions.takeNotices(main.id)).toHaveLength(1);
  });

  it('caps each session on its own', () => {
    const { sessions, main, child } = mainWithChild();

    for (let index = 0; index < MAX_QUEUED_NOTICES; index += 1) {
      sessions.queueNotice({ id: main.id, notice: notice('notes.fill') });
    }

    expect(() =>
      sessions.queueNotice({ id: child.id, notice: notice('notes.child') }),
    ).not.toThrow();
  });

  it.each([
    ['a topic outside the extension namespace', { topic: 'other.x' }],
    ['a topic with spaces', { topic: 'notes.Bad Topic' }],
    ['a version of 0', { version: 0 }],
    ['an empty text', { text: '' }],
    ['a text that is not a string', { text: { length: 5 } }],
    ['a kind that is not an extension notice', { kind: 'hook-failed' }],
  ])('refuses a malformed notice: %s, naming paths and not values', (_name, override) => {
    const { sessions, main } = mainWithChild();
    const bad = { ...notice('notes.ok'), data: { secret: 'sk-hidden' }, ...override };
    let error: unknown;

    try {
      sessions.queueNotice({ id: main.id, notice: bad as QueuedNotice });
    } catch (caughtError) {
      error = caughtError;
    }

    expect(error).toMatchObject({ name: 'SessionError', reason: 'invalid_notice' });
    expect((error as Error).message).not.toContain('sk-hidden');
    expect(sessions.takeNotices(main.id)).toEqual([]);
  });

  it('keeps each session its own notices and leaves the inbox alone', () => {
    const { sessions, main, child } = mainWithChild();

    sessions.queueNotice({ id: child.id, notice: notice('notes.child') });

    expect(sessions.takeNotices(main.id)).toEqual([]);
    expect(sessions.hasMessages(child.id)).toBe(false);
    expect(sessions.takeNotices(child.id)).toHaveLength(1);
  });

  it('queues for an idle session, which delivers it at its next prompt', () => {
    const { sessions, main } = mainWithChild();

    sessions.idle({ id: main.id, outcome: 'completed' });
    sessions.queueNotice({ id: main.id, notice: notice('notes.idle') });

    expect(sessions.takeNotices(main.id)).toHaveLength(1);
  });

  it('throws for an ended session instead of dropping the notice silently', () => {
    const { sessions, child } = mainWithChild();

    sessions.end({ id: child.id, state: 'completed' });

    expect(() => sessions.queueNotice({ id: child.id, notice: notice('notes.late') })).toThrow(
      expect.objectContaining({ reason: 'session_ended' }),
    );
    expect(sessions.takeNotices(child.id)).toEqual([]);
  });

  it('drops the notices of a released session', () => {
    const { sessions, child } = mainWithChild();

    sessions.queueNotice({ id: child.id, notice: notice('notes.gone') });
    sessions.end({ id: child.id, state: 'completed' });
    sessions.release(child.id);

    expect(sessions.takeNotices(child.id)).toEqual([]);
  });

  it('throws for a session the registry does not know', () => {
    const { sessions, child } = mainWithChild();

    sessions.end({ id: child.id, state: 'completed' });
    sessions.release(child.id);

    expect(() => sessions.queueNotice({ id: child.id, notice: notice('notes.late') })).toThrow(
      expect.objectContaining({ reason: 'session_released' }),
    );
  });
});

describe('SessionRegistry publish of an extension event', () => {
  it('puts it on the stream under the session with seq 0, in order, like any event', () => {
    const { sessions, main } = mainWithChild();
    const heard: StreamEntry[] = [];

    sessions.subscribeEntries((entry) => heard.push(entry), { replay: true });
    sessions.publish({
      sessionId: main.id,
      event: {
        seq: 0,
        type: 'extension_event',
        extension: 'notes',
        kind: 'notes.progress',
        version: 1,
        data: { done: 1 },
        text: 'one done',
      },
    });

    const last = heard.at(-1);

    expect(last).toMatchObject({
      sessionId: main.id,
      kind: 'event',
      event: { type: 'extension_event', kind: 'notes.progress' },
    });
    expect(last?.seq).toBe(heard.length - 1);
  });
});
