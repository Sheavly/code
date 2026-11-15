import { describe, expect, it } from 'vitest';
import { until } from '@sheavly/testing/wait/until.fake';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type { ChatConversation } from '../chat.types.js';
import { MAIN_SESSION, doneEntry, quietChat } from '../testing/chat-session.fake.js';

function runState(params: {
  seq: number;
  state: 'working' | 'waiting';
  groupedTasks: number;
}): StreamEntry {
  const { seq, state, groupedTasks } = params;

  return {
    seq,
    at: 0,
    sessionId: MAIN_SESSION,
    kind: 'event',
    event: { seq, type: 'run_state', state, groupedTasks },
  };
}

const working = runState({ seq: 0, state: 'working', groupedTasks: 0 });
const waiting = runState({ seq: 1, state: 'waiting', groupedTasks: 2 });
const finished = runState({ seq: 2, state: 'working', groupedTasks: 0 });

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
      yield doneEntry(10);
    },
  } as unknown as ChatConversation;

  return { session: quietChat({ conversation }), sent, yields, releases };
}

/** Runs 'first' with `states`, queues 'second' behind it, and returns the yields asked so far. */
async function queueBehind(states: StreamEntry[]) {
  const held = chatHeld(states);

  held.session.submit('first');
  await until(() => held.releases.length === 1);
  held.session.submit('second');

  return held;
}

async function finish(held: Awaited<ReturnType<typeof queueBehind>>) {
  held.releases[0]?.();
  await until(() => held.releases.length === 2);
  held.releases[1]?.();
  await held.session.idle();
}

describe('ChatSession: a line queued while the run waits on await_tasks', () => {
  it('stays queued, without asking the prompt to yield', async () => {
    const held = await queueBehind([working, waiting]);

    expect(held.session.queued).toEqual(['second']);
    expect(held.yields).toEqual([]);
    await finish(held);
  });

  it.each([
    ['once the grouped tasks are done and the run works again', [working, waiting, finished]],
    ['at once for a plain working run', [working]],
  ])('asks the prompt to yield %s', async (_name, states) => {
    const held = await queueBehind(states);

    expect(held.yields).toHaveLength(1);
    await finish(held);
  });
});
