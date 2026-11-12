import { describe, expect, it } from 'vitest';
import { until } from '@sheavly/testing/wait/until.fake';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { Renderer } from '../../render/render.service.js';
import { ChatSession } from '../chat-session.service.js';
import type { ChatConversation } from '../chat.types.js';

const MAIN = sessionIdSchema.parse('main');

const done: StreamEntry = {
  seq: 1,
  at: 0,
  sessionId: MAIN,
  kind: 'event',
  event: {
    seq: 1,
    type: 'done',
    reason: 'completed',
    session: { id: MAIN, rootId: MAIN, depth: 1 },
  },
};

/** The parts of a conversation these tests never use. */
const unused = {
  runningTasks: 0,
  skills: async () => [],
  details: async () => {
    throw new Error('not used');
  },
  useModel: async () => false,
};

function sessionFor(params: {
  conversation: ChatConversation;
  onQueue?: (queue: readonly string[]) => void;
}) {
  return new ChatSession({
    conversation: params.conversation,
    renderer: new Renderer(
      () => undefined,
      () => 0,
    ),
    mainSession: MAIN,
    write: () => undefined,
    ...(params.onQueue && { onQueue: params.onQueue }),
    onExit: () => undefined,
  });
}

/** A conversation whose prompts stay open until released, recording what it was asked. */
function holdingChat(params: { yieldReply?: Promise<boolean> } = {}) {
  const sent: string[] = [];
  const opened: string[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const yields: number[] = [];
  const releases: (() => void)[] = [];
  const queues: (readonly string[])[] = [];
  const conversation: ChatConversation = {
    ...unused,
    yieldPrompt: async (signal) => {
      // The prompt each request found running, by how many prompts had started.
      yields.push(sent.length);
      signals.push(signal);

      return params.yieldReply ?? true;
    },
    async *send({ text }) {
      sent.push(text);
      yield { ...done, event: { seq: 0, type: 'text_delta' as const, text: 'working' } };
      // Resumed only once the session handled that entry, so its stream counts as open.
      opened.push(text);
      await new Promise<void>((resolve) => releases.push(resolve));
      yield done;
    },
  };
  const session = sessionFor({ conversation, onQueue: (queue) => queues.push(queue) });

  return { session, sent, opened, signals, yields, releases, queues };
}

describe('ChatSession: queued messages', () => {
  it('keeps ordinary messages pending in order, never starting another prompt while one runs', async () => {
    const { session, sent, releases } = holdingChat();

    session.submit('first');
    await until(() => sent.length === 1);
    session.submit('second');
    session.submit('third');

    expect(session.queued).toEqual(['second', 'third']);
    expect(sent).toEqual(['first']);
    releases[0]?.();
    await until(() => sent.length === 2);
    expect(session.queued).toEqual(['third']);
    releases[1]?.();
    await until(() => sent.length === 3);
    releases[2]?.();
    await session.idle();

    expect(sent).toEqual(['first', 'second', 'third']);
    expect(session.queued).toEqual([]);
  });

  it('only asks the running prompt to yield, once per submitted message, and never stops it', async () => {
    const { session, sent, opened, yields, releases } = holdingChat();

    session.submit('first');
    await until(() => opened.length === 1);
    expect(yields).toEqual([]);
    session.submit('second');
    session.submit('third');
    expect(yields).toHaveLength(2);

    expect(session.stop()).toBe('stopped');
    releases[0]?.();
    await until(() => sent.length === 2);
    session.dropQueued();
    releases[1]?.();
    await session.idle();
  });

  it('asks again once the stream opens when a line arrived before the backend ran the prompt', async () => {
    const { session, sent, opened, yields, releases } = holdingChat();

    session.submit('first');
    session.submit('second');
    expect(yields).toEqual([]);
    await until(() => opened.length === 1);
    await until(() => yields.length === 1);

    expect(yields).toEqual([1]);
    expect(sent).toEqual(['first']);
    releases[0]?.();
    await until(() => opened.length === 2);
    releases[1]?.();
    await session.idle();
  });

  it('lets a slow yield answer land before the next prompt starts, so it cannot end that one', async () => {
    const reply = Promise.withResolvers<boolean>();
    const { session, sent, opened, yields, releases } = holdingChat({ yieldReply: reply.promise });

    session.submit('first');
    await until(() => opened.length === 1);
    session.submit('second');
    await until(() => yields.length === 1);
    releases[0]?.();
    await Promise.resolve();
    expect(sent).toEqual(['first']);

    reply.resolve(true);
    await until(() => sent.length === 2);
    expect(yields).toEqual([1]);
    releases[1]?.();
    await session.idle();
  });

  it('bounds each yield request with a timeout signal', async () => {
    const { session, opened, signals, releases } = holdingChat();

    session.submit('first');
    await until(() => opened.length === 1);
    session.submit('second');
    await until(() => signals.length === 1);

    expect(signals[0]).toBeInstanceOf(AbortSignal);
    releases[0]?.();
    await until(() => opened.length === 2);
    releases[1]?.();
    await session.idle();
  });

  it('lets Ctrl+C stop the next prompt while it waits for a yield answer that never comes', async () => {
    const never = new Promise<boolean>(() => undefined);
    const { session, sent, opened, releases } = holdingChat({ yieldReply: never });

    session.submit('first');
    await until(() => opened.length === 1);
    session.submit('second');
    releases[0]?.();
    await until(() => session.busy && session.queued.length === 0);

    expect(session.stop()).toBe('stopped');
    // The stop ends the wait and the stopped prompt is never sent, instead of hanging.
    await session.idle();

    expect(sent).toEqual(['first']);
    expect(session.busy).toBe(false);
  });

  it('runs a queued line after a prompt that failed before streaming', async () => {
    const sent: string[] = [];
    const session = sessionFor({
      conversation: {
        ...unused,
        yieldPrompt: async () => true,
        async *send({ text }) {
          sent.push(text);
          if (sent.length === 1) throw new Error('backend down');
          yield done;
        },
      },
    });

    session.submit('first');
    session.submit('second');
    await session.idle();

    expect(sent).toEqual(['first', 'second']);
    expect(session.queued).toEqual([]);
  });

  it('keeps a pending line out of everything the conversation sees until it is dispatched', async () => {
    const seen: string[] = [];
    const releases: (() => void)[] = [];
    const session = sessionFor({
      conversation: {
        ...unused,
        // Nothing but a prompt's own text may cross: history, model input and summaries are built
        // from what the conversation receives, so a pending line must not be in any call.
        yieldPrompt: async (...args) => {
          seen.push(JSON.stringify(args));

          return true;
        },
        async *send(params) {
          seen.push(JSON.stringify({ text: params.text }));
          yield { ...done, event: { seq: 0, type: 'text_delta' as const, text: 'working' } };
          await new Promise<void>((resolve) => releases.push(resolve));
          yield done;
        },
      },
    });

    session.submit('first');
    await until(() => releases.length === 1);
    session.submit('PENDING-SECRET');
    await until(() => seen.length >= 2);

    expect(session.queued).toEqual(['PENDING-SECRET']);
    expect(seen.join('')).not.toContain('PENDING-SECRET');

    releases[0]?.();
    await until(() => releases.length === 2);
    expect(seen.join('')).toContain('PENDING-SECRET');
    expect(session.queued).toEqual([]);
    releases[1]?.();
    await session.idle();
  });

  it('does not ask for a yield when nothing runs', async () => {
    const { session, sent, yields, releases } = holdingChat();

    session.submit('only');
    await until(() => sent.length === 1);
    releases[0]?.();
    await session.idle();

    expect(yields).toEqual([]);
  });
});
