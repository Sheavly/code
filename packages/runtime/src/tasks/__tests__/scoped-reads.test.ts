import { afterEach, describe, expect, it } from 'vitest';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { startHeldTask } from '../../testing/held-task.fake.js';
import { TaskRegistry } from '../tasks.service.js';

const parent = sessionIdSchema.parse('main');
const child = sessionIdSchema.parse('main/child');

let registry = new TaskRegistry();

afterEach(async () => {
  await registry.cancelAll();
});

function startHeld(sessionId?: typeof parent) {
  return startHeldTask({ tasks: registry, ...(sessionId && { sessionId }) });
}

describe('reads on a registry shared by sessions', () => {
  it('lists a session its own tasks and the ones with no owner, never another session', () => {
    registry = new TaskRegistry();

    const mine = startHeld(parent);
    const theirs = startHeld(child);
    const generic = startHeld();

    expect(registry.list(parent).map((t) => t.id)).toEqual([mine.id, generic.id]);
    expect(registry.list(child).map((t) => t.id)).toEqual([theirs.id, generic.id]);
    expect(registry.list().map((t) => t.id)).toEqual([mine.id, theirs.id, generic.id]);
  });

  it('reads another session task as unknown, so its id reveals nothing', () => {
    registry = new TaskRegistry();

    const theirs = startHeld(child);

    expect(registry.getOwned({ id: theirs.id, sessionId: parent })).toBeUndefined();
    expect(registry.getOwned({ id: theirs.id, sessionId: child })?.id).toBe(theirs.id);
    expect(registry.getOwned({ id: theirs.id, sessionId: undefined })?.id).toBe(theirs.id);
  });

  it('finds a task by call id only among the ones the session owns', () => {
    registry = new TaskRegistry();

    const callId = callIdSchema.parse('call_0');
    const theirs = startHeldTask({ tasks: registry, sessionId: child, callId });

    expect(registry.byCallId({ callId, sessionId: parent })).toBeUndefined();
    expect(registry.byCallId({ callId, sessionId: child })?.id).toBe(theirs.id);
  });

  it('gives ids that never collide between sessions', () => {
    registry = new TaskRegistry();

    const ids = [startHeld(parent), startHeld(child), startHeld(child)].map((t) => t.id);

    expect(new Set(ids).size).toBe(3);
  });

  it('cancelSession stops exactly one session and no task of another or without an owner', async () => {
    registry = new TaskRegistry();

    const mine = startHeld(parent);
    const theirs = startHeld(child);
    const generic = startHeld();

    await registry.cancelSession(child);

    expect(registry.get(theirs.id)?.status).toBe('cancelled');
    expect(registry.get(mine.id)?.status).toBe('running');
    expect(registry.get(generic.id)?.status).toBe('running');
  });
});
