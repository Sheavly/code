import { describe, expect, it } from 'vitest';
import { until } from '@sheavly/testing/wait/until.fake';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { Renderer } from '../../render/render.service.js';
import { ChatSession } from '../chat-session.service.js';
import type { ChatConversation } from '../chat.types.js';

const MAIN = sessionIdSchema.parse('main');

const runState = (params: {
  seq: number;
  state: 'working' | 'waiting';
  groupedTasks: number;
}): StreamEntry => ({
  seq: params.seq,
  at: 0,
  sessionId: MAIN,
  kind: 'event',
  event: {
    seq: params.seq,
    type: 'run_state',
    state: params.state,
    groupedTasks: params.groupedTasks,
  },
});

const working = runState({ seq: 0, state: 'working', groupedTasks: 0 });
const waiting = runState({ seq: 1, state: 'waiting', groupedTasks: 2 });
const finished = runState({ seq: 2, state: 'working', groupedTasks: 0 });
const done: StreamEntry = {
  seq: 3,
  at: 0,
  sessionId: MAIN,
  kind: 'event',
  event: {
    seq: 3,
    type: 'done',
    reason: 'completed',
    session: { id: MAIN, rootId: MAIN, depth: 1 },
  },
};

/** A chat whose first prompt streams `states` and then stays open until released. */
function chatHeld(states: StreamEntry[]) {
  const sent: string[] = [];
  const yields: number[] = [];
  const releases: (() => void)[] = [];
  const conversation = {
    runningTasks: 0,
    skills: () => Promise.resolve([]),
    yieldPrompt: () => {
      yields.push(sent.length);

      return Promise.resolve(true);
    },
    async *send({ text }: { text: string }) {
      sent.push(text);
      yield* states;
      await new Promise<void>((resolve) => releases.push(resolve));
      yield done;
    },
  } as unknown as ChatConversation;
  const session = new ChatSession({
    conversation,
    renderer: new Renderer(
      () => undefined,
      () => 0,
    ),
    mainSession: MAIN,
    write: () => undefined,
    onExit: () => undefined,
  });

  return { session, sent, yields, releases };
}

describe('ChatSession: a line queued while the run waits on await_tasks', () => {
  it('stays queued, without asking the prompt to yield', async () => {
    const { session, sent, yields, releases } = chatHeld([working, waiting]);

    session.submit('first');
    await until(() => releases.length === 1);
    session.submit('second');

    expect(session.queued).toEqual(['second']);
    expect(yields).toEqual([]);
    releases[0]?.();
    await until(() => sent.length === 2);
    releases[1]?.();
    await session.idle();
  });

  it('asks it to yield once the grouped tasks are done and the run works again', async () => {
    const { session, yields, releases } = chatHeld([working, waiting, finished]);

    session.submit('first');
    await until(() => releases.length === 1);
    session.submit('second');

    expect(yields).toHaveLength(1);
    releases[0]?.();
    await until(() => releases.length === 2);
    releases[1]?.();
    await session.idle();
  });

  it('asks a plain working run to yield, as before', async () => {
    const { session, yields, releases } = chatHeld([working]);

    session.submit('first');
    await until(() => releases.length === 1);
    session.submit('second');

    expect(yields).toHaveLength(1);
    releases[0]?.();
    await until(() => releases.length === 2);
    releases[1]?.();
    await session.idle();
  });
});
