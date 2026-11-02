import { describe, expect, it } from 'vitest';
import { SessionRegistry } from '../sessions.service.js';
import { toServerSentEvent } from '../sessions.utils.js';
import { startDeepestSession } from '../../../testing/sessions.fake.js';
import type { SessionUpdate } from '@sheavly/protocol/session/session.types';

describe('SessionRegistry', () => {
  it('gives every session a unique id, linked to its parent and the main session', () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Main' });
    const child = sessions.startChild({ parentId: main.id, title: 'Child' });
    const grandchild = sessions.startChild({ parentId: child.id, title: 'Grandchild' });

    expect(main).toEqual({ id: main.id, rootId: main.id, depth: 1 });
    expect(child).toEqual({ id: child.id, parentId: main.id, rootId: main.id, depth: 2 });
    expect(grandchild).toEqual({
      id: grandchild.id,
      parentId: child.id,
      rootId: main.id,
      depth: 3,
    });
    expect(new Set([main.id, child.id, grandchild.id]).size).toBe(3);
    expect(sessions.lineage(grandchild.id).map((s) => s.title)).toEqual([
      'Grandchild',
      'Child',
      'Main',
    ]);
    expect(sessions.children(main.id).map((s) => s.id)).toEqual([child.id]);
  });

  it('caps nesting at three levels: a fourth is refused', () => {
    const sessions = new SessionRegistry();
    const three = startDeepestSession(sessions);

    expect(() => sessions.startChild({ parentId: three.id, title: '4' })).toThrow(
      'Sub-agents nest at most 3 levels',
    );
    expect(sessions.list()).toHaveLength(3);
  });

  it('refuses a sub-agent with no known, running parent, so none floats free', () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Main' });

    expect(() => sessions.startChild({ parentId: 'nope', title: 'Orphan' })).toThrow(
      'Unknown parent session nope',
    );
    sessions.end({ id: main.id, state: 'completed' });
    expect(() => sessions.startChild({ parentId: main.id, title: 'Late' })).toThrow('has ended');
  });

  it('records status reports and endings, and tells listeners in order', () => {
    const sessions = new SessionRegistry();
    const updates: string[] = [];

    sessions.subscribe((u) =>
      updates.push(`${u.type}:${u.session.title}:${u.session.status ?? ''}:${u.session.state}`),
    );

    const main = sessions.startMain({ title: 'Main' });

    sessions.report({ id: main.id, status: 'reading files' });
    sessions.report({ id: main.id, status: 'editing core package' });
    sessions.end({ id: main.id, state: 'completed' });
    sessions.report({ id: main.id, status: 'ignored after end' });
    sessions.end({ id: main.id, state: 'failed' }); // first ending wins

    expect(updates).toEqual([
      'session_started:Main::running',
      'session_status:Main:reading files:running',
      'session_status:Main:editing core package:running',
      'session_ended:Main:editing core package:completed',
    ]);
    expect(sessions.get(main.id)).toMatchObject({
      state: 'completed',
      status: 'editing core package',
    });
  });

  it('streams updates as server-sent events: known sessions first, then live', async () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Main' });
    const stop = new AbortController();
    const reader = sessions.stream({ signal: stop.signal }).getReader();
    const decoder = new TextDecoder();

    sessions.report({ id: main.id, status: 'reading files' });
    stop.abort();

    let text = '';

    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      text += decoder.decode(chunk.value);
    }

    const events = text.split('\n\n').filter(Boolean);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatch(new RegExp(`^event: session_started\nid: ${main.id}\ndata: \\{`));
    expect(events[1]).toContain('event: session_status');
    expect(JSON.parse(events[1]?.split('data: ')[1] ?? '{}')).toMatchObject({
      session: { status: 'reading files' },
    });
  });
});

describe('toServerSentEvent', () => {
  it('names the event, sets the id, and sends the rest of the update as JSON', () => {
    const update: SessionUpdate = {
      type: 'session_status',
      session: {
        id: 's1',
        rootId: 's1',
        depth: 1,
        title: 'T',
        status: 'x',
        state: 'running',
        startedAt: 0,
      },
    };

    expect(toServerSentEvent(update)).toBe(
      'event: session_status\nid: s1\ndata: {"session":{"id":"s1","rootId":"s1","depth":1,"title":"T","status":"x","state":"running","startedAt":0}}\n\n',
    );
  });

  it('includes the message for session_message', () => {
    const update: SessionUpdate = {
      type: 'session_message',
      session: {
        id: 's2',
        parentId: 's1',
        rootId: 's1',
        depth: 2,
        title: 'T',
        state: 'running',
        startedAt: 0,
      },
      message: { from: 's1', content: 'focus on puppies', sentAt: 5 },
    };
    const data = JSON.parse(toServerSentEvent(update).split('data: ')[1] ?? '{}') as unknown;

    expect(data).toMatchObject({
      session: { id: 's2' },
      message: { from: 's1', content: 'focus on puppies' },
    });
  });
});

describe('SessionRegistry inbox', () => {
  it('queues messages for a running session, oldest first, and takes them once', () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Main' });

    sessions.send({ id: main.id, content: 'one', from: 'user' });
    sessions.send({ id: main.id, content: 'two', from: 'user' });

    expect(sessions.hasMessages(main.id)).toBe(true);
    expect(sessions.takeMessages(main.id).map((m) => m.content)).toEqual(['one', 'two']);
    expect(sessions.takeMessages(main.id)).toEqual([]);
    expect(sessions.hasMessages(main.id)).toBe(false);
  });

  it('lets an ancestor message a sub-agent, and nobody else', () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Main' });
    const a = sessions.startChild({ parentId: main.id, title: 'A' });
    const aa = sessions.startChild({ parentId: a.id, title: 'AA' });
    const b = sessions.startChild({ parentId: main.id, title: 'B' });

    sessions.send({ id: aa.id, content: 'from parent', from: a.id });
    sessions.send({ id: aa.id, content: 'from main', from: main.id });
    expect(sessions.takeMessages(aa.id).map((m) => m.from)).toEqual([a.id, main.id]);

    expect(() => sessions.send({ id: aa.id, content: 'x', from: b.id })).toThrow('did not start');
    expect(() => sessions.send({ id: main.id, content: 'x', from: a.id })).toThrow('did not start');
    expect(() => sessions.send({ id: a.id, content: 'x', from: a.id })).toThrow('did not start');
    expect(() => sessions.send({ id: 'nope', content: 'x', from: 'user' })).toThrow(
      'Unknown session',
    );
  });

  it('refuses messages to an ended session', () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Main' });

    sessions.end({ id: main.id, state: 'completed' });
    expect(() => sessions.send({ id: main.id, content: 'late', from: 'user' })).toThrow(
      'has ended',
    );
  });

  it('tells listeners (and so the SSE stream) about each message', () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Main' });
    const seen: string[] = [];

    sessions.subscribe((u) => {
      if (u.type === 'session_message') seen.push(`${u.session.id}:${u.message.content}`);
    });
    sessions.send({ id: main.id, content: 'hello', from: 'user' });

    expect(seen).toEqual([`${main.id}:hello`]);
  });

  it('wakes a loop waiting for a message, and when the session ends', async () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Main' });
    const woken: string[] = [];

    const first = sessions.nextMessage(main.id).then(() => woken.push('message'));

    sessions.send({ id: main.id, content: 'hi', from: 'user' });
    await first;

    const second = sessions.nextMessage(main.id).then(() => woken.push('ended'));

    sessions.end({ id: main.id, state: 'completed' });
    await second;

    expect(woken).toEqual(['message', 'ended']);
  });
});
