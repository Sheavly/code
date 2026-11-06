import { describe, expect, it } from 'vitest';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { Renderer } from '../../render/render.service.js';
import { ChatSession } from '../chat-session.service.js';
import type { ChatConversation, TurnOutcome } from '../chat.types.js';

const MAIN = sessionIdSchema.parse('main');

const reply = (value: string): StreamEntry => ({
  seq: 0,
  at: 0,
  sessionId: MAIN,
  kind: 'event',
  event: { seq: 0, type: 'text_delta', text: value },
});

function done(reason: 'completed' | 'interrupted' | 'max_turns' = 'completed'): StreamEntry {
  return {
    seq: 1,
    at: 0,
    sessionId: MAIN,
    kind: 'event',
    event: { seq: 1, type: 'done', reason, session: { id: MAIN, rootId: MAIN, depth: 1 } },
  };
}

/** A chat whose prompts answer `answer`, or fail when `fails`; it notes how each one ended. */
function chat(params: {
  fails?: boolean;
  skills?: string[];
  events?: StreamEntry[];
  afterStream?: () => void;
}) {
  const written: string[] = [];
  const ends: { outcome: TurnOutcome; writes: number }[] = [];
  const completedWrites: number[] = [];
  const conversation = {
    runningTasks: 0,
    skills: () =>
      Promise.resolve(
        (params.skills ?? []).map((name) => ({
          name,
          description: '',
          manualOnly: false,
          scope: 'project' as const,
        })),
      ),
    async *send() {
      await Promise.resolve();
      if (params.fails) throw new Error('the backend went away');
      yield* params.events ?? [reply('done'), done()];
      params.afterStream?.();
    },
  } as unknown as ChatConversation;
  const session = new ChatSession({
    conversation,
    renderer: new Renderer(
      (out) => written.push(out),
      () => 0,
    ),
    mainSession: MAIN,
    write: (out) => written.push(out),
    onTurnEnd: (outcome) => ends.push({ outcome, writes: written.length }),
    onReplyComplete: () => completedWrites.push(written.length),
    onExit: () => undefined,
  });

  return { session, written, ends, completedWrites };
}

describe('ChatSession: the end of a message', () => {
  it('tells the UI a message completed, after everything it printed', async () => {
    const { session, written, ends, completedWrites } = chat({});

    session.submit('hello');
    await session.idle();

    expect(ends).toEqual([{ outcome: 'completed', writes: written.length }]);
    expect(written.join('')).toContain('done');
    expect(completedWrites).toEqual([written.length]);
  });

  it('tells the UI a message failed, after the error was shown', async () => {
    const { session, written, ends, completedWrites } = chat({ fails: true });

    session.submit('hello');
    await session.idle();

    expect(written.join('')).toContain('the backend went away');
    expect(ends).toEqual([{ outcome: 'failed', writes: written.length }]);
    expect(completedWrites).toEqual([]);
  });

  it('counts a command no skill has as a message that completed, since nothing failed', async () => {
    const { session, written, ends, completedWrites } = chat({});

    session.submit('/nope');
    await session.idle();

    expect(written.join('')).toContain('Unknown command /nope');
    expect(ends).toEqual([{ outcome: 'completed', writes: written.length }]);
    expect(completedWrites).toEqual([]);
  });

  it('tells nothing for a line that is not a message, like /help', async () => {
    const { session, ends } = chat({});

    session.submit('/help');
    await session.idle();

    expect(ends).toEqual([]);
  });

  it('tells it once for each message, in order', async () => {
    const { session, ends, completedWrites } = chat({});

    session.submit('one');
    session.submit('two');
    await session.idle();

    expect(ends.map(({ outcome }) => outcome)).toEqual(['completed', 'completed']);
    expect(completedWrites).toHaveLength(2);
  });

  it.each(['interrupted', 'max_turns'] as const)(
    'does not notify reply completion for %s',
    async (reason) => {
      const { session, completedWrites } = chat({ events: [reply('partial'), done(reason)] });

      session.submit('hello');
      await session.idle();

      expect(completedWrites).toEqual([]);
    },
  );

  it('does not notify when a stream closes without the main session confirming completion', async () => {
    const { session, completedWrites } = chat({ events: [reply('partial')] });

    session.submit('hello');
    await session.idle();

    expect(completedWrites).toEqual([]);
  });

  it('does not mistake a sub-agent completion for the main reply completing', async () => {
    const child = sessionIdSchema.parse('child');
    const childDone: StreamEntry = {
      ...done(),
      sessionId: child,
      kind: 'event',
      event: {
        seq: 1,
        type: 'done',
        reason: 'completed',
        session: {
          id: child,
          rootId: MAIN,
          parentId: MAIN,
          depth: 2,
          startedByCall: callIdSchema.parse('start-child'),
        },
      },
    };
    const { session, completedWrites } = chat({ events: [reply('partial'), childDone] });

    session.submit('hello');
    await session.idle();

    expect(completedWrites).toEqual([]);
  });

  it('suppresses completion when the user stopped while the final event was arriving', async () => {
    const result = chat({ afterStream: () => result.session.stop() });

    result.session.submit('hello');
    await result.session.idle();

    expect(result.completedWrites).toEqual([]);
  });
});
