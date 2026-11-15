import { describe, expect, it } from 'vitest';
import type { AgentEventBody } from '@sheavly/protocol/event/event.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { HookError } from '../../errors/loop.errors.js';
import { OrderedQueue } from '../../queue/queue.service.js';
import { createHookFailures } from '../hook-failures.helper.js';

function setup() {
  const released: AgentEventBody[] = [];
  const events = new OrderedQueue<AgentEventBody>({
    onRelease: (event) => released.push(event),
  });
  const failures = createHookFailures(events);
  const fail = (hook: string, handler: 'beforeTurn' | 'afterTurn' = 'beforeTurn', cause = 'boom') =>
    failures.report(new HookError({ hook, handler, cause: new Error(cause) }));

  return { released, failures, fail };
}

const noticesIn = (messages: HistoryMessage[]) =>
  messages.flatMap((message) => (message.role === 'notice' ? [message.notice] : []));

describe('createHookFailures', () => {
  it('emits hook_failed at once, with the error redacted, but tells the model only on deliver', () => {
    const { released, failures, fail } = setup();
    const messages: HistoryMessage[] = [];

    fail('audit', 'beforeTurn', 'failed: api_key=hunter2');

    expect(released).toEqual([
      expect.objectContaining({ type: 'hook_failed', hook: 'audit', handler: 'beforeTurn' }),
    ]);
    expect(JSON.stringify(released)).not.toContain('hunter2');
    expect(messages).toEqual([]);

    failures.deliver(messages);

    expect(noticesIn(messages)).toEqual([
      expect.objectContaining({ kind: 'hook-failed', hook: 'audit', handler: 'beforeTurn' }),
    ]);
    expect(JSON.stringify(messages)).not.toContain('hunter2');
  });

  it('delivers each failure once: nothing is repeated at the next call', () => {
    const { failures, fail } = setup();
    const messages: HistoryMessage[] = [];

    fail('audit');
    failures.deliver(messages);
    failures.deliver(messages);

    expect(noticesIn(messages)).toHaveLength(1);
  });

  it('folds repeated failures of one hook and handler into one notice with a count', () => {
    const { failures, fail } = setup();
    const messages: HistoryMessage[] = [];

    fail('audit');
    fail('audit');
    fail('audit');
    failures.deliver(messages);

    expect(noticesIn(messages)).toEqual([expect.objectContaining({ hook: 'audit', repeats: 2 })]);
  });

  it('tells the model again every round a hook fails, with that round’s error, so it can tell the user', () => {
    const { failures, fail } = setup();
    const messages: HistoryMessage[] = [];

    fail('audit', 'beforeTurn', 'first');
    failures.deliver(messages);
    fail('audit', 'beforeTurn', 'second');
    fail('other');
    fail('audit', 'afterTurn');
    failures.deliver(messages);

    expect(noticesIn(messages)).toEqual([
      expect.objectContaining({ hook: 'audit', handler: 'beforeTurn' }),
      expect.objectContaining({ hook: 'audit', handler: 'beforeTurn' }),
      expect.objectContaining({ hook: 'other', handler: 'beforeTurn' }),
      expect.objectContaining({ hook: 'audit', handler: 'afterTurn' }),
    ]);
    expect(JSON.stringify(noticesIn(messages)[1])).toContain('second');
    // One failure per round: no count.
    expect(noticesIn(messages)[1]).not.toHaveProperty('repeats');
  });
});
