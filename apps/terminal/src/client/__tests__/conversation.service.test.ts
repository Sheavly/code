import { describe, expect, it } from 'vitest';
import { fakeServer } from '@sheavly/client/testing/fake-server.fake';
import type { FakeHandlers } from '@sheavly/client/testing/testing.types';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import { RemoteConversation } from '../conversation.service.js';

const ID = conversationIdSchema.parse('c1');
const MAIN = sessionIdSchema.parse('main');
const SESSION = { id: MAIN, rootId: MAIN, depth: 1 };

const text = (seq: number, value: string): StreamEntry => ({
  seq,
  at: 0,
  sessionId: MAIN,
  kind: 'event',
  event: { seq, type: 'text_delta', text: value },
});
const done = (seq: number, reason: 'completed' | 'interrupted'): StreamEntry => ({
  seq,
  at: 0,
  sessionId: MAIN,
  kind: 'event',
  event: { seq, type: 'done', reason, session: SESSION },
});
const TASK = {
  id: taskIdSchema.parse('t1'),
  command: 'npm run dev',
  description: 'Dev server',
  startedAt: 1,
  output: '',
};
const task = (seq: number, type: 'task_started' | 'task_ended'): StreamEntry => ({
  seq,
  at: 0,
  sessionId: MAIN,
  kind: 'task',
  update: { type, task: { ...TASK, status: type === 'task_started' ? 'running' : 'completed' } },
});

/** A conversation on a fake backend that answers the routes as `handlers` say. */
async function open(handlers: FakeHandlers) {
  const server = fakeServer({ startConversation: () => ({ id: ID }), ...handlers });
  const conversation = await RemoteConversation.open({
    backend: {
      url: 'http://backend.test',
      token: 't',
      stop: async () => undefined,
      fetch: server.fetch,
    },
  });

  return { conversation, server };
}

async function* entries(...list: StreamEntry[]): AsyncIterable<StreamEntry> {
  yield* list;
}

/** Every entry of a prompt, to its end. */
async function sent(conversation: RemoteConversation, signal?: AbortSignal) {
  const seen: StreamEntry[] = [];

  for await (const entry of conversation.send({ text: 'hi', ...(signal && { signal }) })) {
    seen.push(entry);
  }

  return seen;
}

describe('RemoteConversation', () => {
  it('starts a conversation, sends a prompt and reads its entries, then the history', async () => {
    const { conversation, server } = await open({
      sendPrompt: () => entries(text(0, 'hello'), done(1, 'completed')),
      getMessages: () => ({ messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect((await sent(conversation)).map((entry) => entry.seq)).toEqual([0, 1]);
    expect(await conversation.messages()).toEqual([{ role: 'user', content: 'hi' }]);
    expect(server.calls.find(({ name }) => name === 'sendPrompt')?.call).toEqual({
      params: { id: ID },
      body: { text: 'hi' },
    });
  });

  it('switches to a model, and says false for one the backend hasn’t, without throwing', async () => {
    const { conversation } = await open({
      switchModel: ({ body }) =>
        (body as { name: string }).name === 'deep'
          ? undefined
          : { refuse: { status: 422, code: 'unknown_model' } },
    });

    expect(await conversation.useModel('deep')).toBe(true);
    expect(await conversation.useModel('huge')).toBe(false);
  });

  it('throws any other refusal, with the backend’s code', async () => {
    const { conversation } = await open({
      switchModel: () => ({ refuse: { status: 404, code: 'not_found' } }),
    });

    await expect(conversation.useModel('deep')).rejects.toMatchObject({
      name: 'RefusedError',
      code: 'not_found',
    });
  });

  it('asks the backend to stop the prompt when its signal aborts', async () => {
    const stop = new AbortController();
    const { conversation, server } = await open({
      async *sendPrompt() {
        yield text(0, 'working');
        stop.abort();
        // The backend answers the stop with the prompt's `done`, as the real one does.
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield done(1, 'interrupted');
      },
      stopPrompt: () => undefined,
    });

    const seen = await sent(conversation, stop.signal);

    expect(seen.at(-1)).toMatchObject({ event: { reason: 'interrupted' } });
    expect(server.calls.map(({ name }) => name)).toContain('stopPrompt');
  });

  it('counts a background task from its start in the stream to its end', async () => {
    const counts: number[] = [];
    const { conversation } = await open({
      sendPrompt: () =>
        entries(task(0, 'task_started'), task(1, 'task_ended'), done(2, 'completed')),
    });

    for await (const _entry of conversation.send({ text: 'hi' })) {
      counts.push(conversation.runningTasks);
    }

    expect(counts).toEqual([1, 0, 0]);
  });

  it('counts a task as ended when the next prompt is told it completed', async () => {
    const completed: StreamEntry = {
      seq: 2,
      at: 0,
      sessionId: MAIN,
      kind: 'event',
      event: { seq: 0, type: 'task_completed', task: { ...TASK, status: 'failed' } },
    };
    const prompts = [
      [task(0, 'task_started'), done(1, 'completed')],
      [completed, done(3, 'completed')],
    ];
    const { conversation } = await open({ sendPrompt: () => entries(...(prompts.shift() ?? [])) });

    await sent(conversation);
    expect(conversation.runningTasks).toBe(1);
    await sent(conversation);
    expect(conversation.runningTasks).toBe(0);
  });

  it('searches skills with a typed body, and lists them all without one', async () => {
    const { conversation, server } = await open({ querySkills: () => ({ skills: [] }) });

    await conversation.skills('rev');
    await conversation.skills();

    expect(
      server.calls.filter(({ name }) => name === 'querySkills').map(({ call }) => call.body),
    ).toEqual([{ search: 'rev' }, {}]);
  });
});
