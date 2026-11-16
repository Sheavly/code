import { describe, expect, it } from 'vitest';
import { fakeServer } from '@sheavly/client/testing/fake-server.fake';
import type { FakeHandlers } from '@sheavly/client/testing/testing.types';
import { approvalIdSchema } from '@sheavly/protocol/approval/approval.validator';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import { ENDED_TASKS_KEPT } from '../client.constants.js';
import { RemoteConversation } from '../conversation.service.js';

const ID = conversationIdSchema.parse('00000000-0000-4000-8000-000000000001');
/** Two models' ids: the backend has `DEEP` and not `OTHER`. */
const DEEP = '9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71';
const OTHER = '00000000-0000-4000-8000-000000000000';
const MAIN = sessionIdSchema.parse('main');
const SESSION = { id: MAIN, rootId: MAIN, depth: 1 as const };

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
  kind: 'task' as const,
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

/**
 * A conversation that sends two prompts, each answered by the next of `prompts`, with the task
 * count `watchBackground` was told along the way.
 */
async function replaying(prompts: [StreamEntry[], StreamEntry[]]) {
  const queue = [...prompts];
  const { conversation } = await open({ sendPrompt: () => entries(...(queue.shift() ?? [])) });
  const told: number[] = [];

  conversation.watchBackground(({ tasks }) => told.push(tasks));
  await sent(conversation);
  await sent(conversation);

  return { told, conversation };
}

/** A task `id` of `kind` starting at `seq`. */
const started = (
  seq: number,
  id: string,
  kind: 'task' | 'agent' | 'service' = 'task',
): StreamEntry => ({
  seq,
  at: 0,
  sessionId: MAIN,
  kind: 'task',
  update: {
    type: 'task_started',
    task: { ...TASK, id: taskIdSchema.parse(id), status: 'running', kind },
  },
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
  it('reopens a saved conversation without creating a new one', async () => {
    const server = fakeServer({ reopenConversation: () => ({ id: ID }) });
    const conversation = await RemoteConversation.reopen({
      backend: {
        url: 'http://backend.test',
        token: 't',
        stop: async () => undefined,
        fetch: server.fetch,
      },
      id: ID,
    });

    expect(conversation.id).toBe(ID);
    expect(server.calls.map((call) => call.name)).toEqual(['reopenConversation']);
    expect(server.calls[0]?.call).toEqual({ params: { id: ID } });
  });
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

  it.each([true, false])('returns yield acceptance %s from the backend', async (accepted) => {
    const { conversation, server } = await open({ yieldPrompt: () => ({ accepted }) });

    expect(await conversation.yieldPrompt()).toBe(accepted);
    expect(server.calls.find(({ name }) => name === 'yieldPrompt')?.call).toEqual({
      params: { id: ID },
    });
    expect(server.calls.some(({ name }) => name === 'stopPrompt')).toBe(false);
  });

  it('reports a failed yield request instead of treating it as idle', async () => {
    const { conversation } = await open({
      yieldPrompt: () => ({ refuse: { status: 404, code: 'not_found' } }),
    });

    await expect(conversation.yieldPrompt()).rejects.toMatchObject({
      name: 'RefusedError',
      code: 'not_found',
    });
  });

  it('reports a failed main run after partial text instead of silently becoming ready', async () => {
    const failed: StreamEntry = {
      seq: 1,
      at: 0,
      sessionId: MAIN,
      kind: 'event',
      event: { seq: 1, type: 'done', reason: 'failed', session: SESSION },
    };
    const { conversation } = await open({
      sendPrompt: () => entries(text(0, 'Now the design doc.'), failed),
    });

    await expect(sent(conversation)).rejects.toThrow('The model run failed before completing');
  });

  it('does not mistake a failed sub-agent for a failed main run', async () => {
    const child = sessionIdSchema.parse('child');
    const { conversation } = await open({
      sendPrompt: () =>
        entries(
          {
            seq: 0,
            at: 0,
            sessionId: child,
            kind: 'update',
            update: {
              type: 'session_idle',
              session: {
                id: child,
                rootId: MAIN,
                parentId: MAIN,
                startedByCall: callIdSchema.parse('child-call'),
                depth: 2,
                title: 'Child',
                state: 'idle',
                startedAt: 0,
                lastOutcome: 'failed',
              },
            },
          },
          done(1, 'completed'),
        ),
    });

    expect((await sent(conversation)).at(-1)).toMatchObject({ event: { reason: 'completed' } });
  });

  it('switches to a model by id, and says false for one the backend hasn’t, without throwing', async () => {
    const { conversation } = await open({
      switchModel: ({ body }) =>
        (body as { id: string }).id === DEEP
          ? undefined
          : { refuse: { status: 422, code: 'unknown_model' } },
    });

    expect(await conversation.useModel(modelIdSchema.parse(DEEP))).toBe(true);
    expect(await conversation.useModel(modelIdSchema.parse(OTHER))).toBe(false);
  });

  it('sends the id and nothing else: the label is never what is switched by', async () => {
    const { conversation, server } = await open({ switchModel: () => undefined });

    await conversation.useModel(modelIdSchema.parse(DEEP));
    expect(server.calls.find(({ name }) => name === 'switchModel')?.call.body).toEqual({
      id: DEEP,
    });
  });

  it('throws any other refusal, with the backend’s code', async () => {
    const { conversation } = await open({
      switchModel: () => ({ refuse: { status: 404, code: 'not_found' } }),
    });

    await expect(conversation.useModel(modelIdSchema.parse(DEEP))).rejects.toMatchObject({
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

  it('splits what runs in the background into tasks, agents and services, and tells a watcher', async () => {
    const told: { tasks: number; agents: number; services: number }[] = [];
    const { conversation } = await open({
      sendPrompt: () =>
        entries(
          started(0, 't1', 'service'),
          started(1, 't2', 'task'),
          started(2, 't3', 'task'),
          started(3, 't4', 'agent'),
          task(4, 'task_ended'),
          done(5, 'completed'),
        ),
    });

    conversation.watchBackground((background) => told.push(background));
    await sent(conversation);

    // The `task_ended` helper ends t1, the service.
    expect(told).toEqual([
      { tasks: 0, agents: 0, services: 0 },
      { tasks: 0, agents: 0, services: 1 },
      { tasks: 1, agents: 0, services: 1 },
      { tasks: 2, agents: 0, services: 1 },
      { tasks: 2, agents: 1, services: 1 },
      { tasks: 2, agents: 1, services: 0 },
    ]);
    expect(conversation.background).toEqual({ tasks: 2, agents: 1, services: 0 });
  });

  it('does not bring a task back when its start is seen again after its end', async () => {
    // The second stream replays the start after the end was counted, as the live feed can.
    const { told, conversation } = await replaying([
      [task(0, 'task_started'), task(1, 'task_ended'), done(2, 'completed')],
      [task(0, 'task_started'), done(3, 'completed')],
    ]);

    expect(told).toEqual([0, 1, 0]);
    expect(conversation.background).toEqual({ tasks: 0, agents: 0, services: 0 });
  });

  it('treats ended as final: an end seen before its start, or twice, never counts a task', async () => {
    const { told, conversation } = await replaying([
      [task(1, 'task_ended'), task(0, 'task_started'), done(2, 'completed')],
      [task(1, 'task_ended'), done(3, 'completed')],
    ]);

    // Told once on subscribe; the end came first, so the late start and the repeated end say nothing.
    expect(told).toEqual([0]);
    expect(conversation.background).toEqual({ tasks: 0, agents: 0, services: 0 });
  });

  it('remembers only the last ENDED_TASKS_KEPT ended ids, so a long chat does not grow', async () => {
    const ended = (seq: number, id: string): StreamEntry => ({
      seq,
      at: 0,
      sessionId: MAIN,
      kind: 'task',
      update: {
        type: 'task_ended',
        task: { ...TASK, id: taskIdSchema.parse(id), status: 'completed' },
      },
    });
    const total = ENDED_TASKS_KEPT + 5;
    const ids = Array.from({ length: total }, (_, index) => `t${String(index + 1)}`);
    const lifecycles = ids.flatMap((id, index) => [
      started(index * 2, id),
      ended(index * 2 + 1, id),
    ]);
    const { conversation } = await replaying([
      [...lifecycles, done(total * 2, 'completed')],
      // The oldest id was forgotten, so a start for it counts again; the newest is still known.
      [started(0, 't1'), started(0, ids[total - 1] ?? ''), done(total * 2 + 1, 'completed')],
    ]);

    expect(conversation.background).toEqual({ tasks: 1, agents: 0, services: 0 });
  });

  it('counts another task’s start that arrives with a lower seq than one already counted', async () => {
    const prompts = [
      [started(12, 't1'), done(13, 'completed')],
      [started(9, 't2'), done(14, 'completed')],
    ];
    const { conversation } = await open({ sendPrompt: () => entries(...(prompts.shift() ?? [])) });

    await sent(conversation);
    await sent(conversation);

    expect(conversation.background).toEqual({ tasks: 2, agents: 0, services: 0 });
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

  describe('approvals', () => {
    it('also delivers background-agent usage while no prompt is being sent', async () => {
      const usage: StreamEntry = {
        seq: 0,
        at: 0,
        sessionId: sessionIdSchema.parse('child'),
        kind: 'event',
        event: {
          seq: 0,
          type: 'usage',
          usage: {
            tokens: {
              inputTokens: 100,
              outputTokens: 20,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
          },
        },
      };
      const { conversation } = await open({ streamConversation: () => entries(usage) });
      const heard: StreamEntry[] = [];
      const { ended } = await conversation.watchApprovals({
        onApproval: () => undefined,
        onUsage: (entry) => heard.push(entry),
        signal: new AbortController().signal,
      });

      await ended;
      expect(heard).toEqual([usage]);
    });

    const asked = (seq: number, id: string): StreamEntry => ({
      seq,
      at: 0,
      sessionId: MAIN,
      kind: 'approval',
      update: {
        type: 'approval_requested',
        request: {
          id: approvalIdSchema.parse(id),
          callId: callIdSchema.parse('c1'),
          tool: 'run_command',
          command: 'npm test',
          concerns: [{ argument: 'npm test', reason: 'is not allowed yet' }],
          options: ['approve', 'always_allow', 'skip', 'skip_with_message'],
        },
      },
    });

    it('says it will answer, so a command waits instead of being refused, and hears each update', async () => {
      const { conversation, server } = await open({
        streamConversation: () =>
          entries(asked(0, 'a1'), text(1, 'not an approval'), {
            seq: 2,
            at: 0,
            sessionId: MAIN,
            kind: 'approval',
            update: { type: 'approval_cancelled', id: approvalIdSchema.parse('a1') },
          }),
      });
      const heard: string[] = [];
      const { ended } = await conversation.watchApprovals({
        onApproval: ({ update }) => heard.push(update.type),
        signal: new AbortController().signal,
      });

      await ended;

      expect(heard).toEqual(['approval_requested', 'approval_cancelled']);
      // Replayed, so sub-agents already running are known by name when they ask.
      expect(server.calls.find(({ name }) => name === 'streamConversation')?.call.body).toEqual({
        approvals: true,
        replay: true,
      });
    });

    it('is connected by the time it resolves, so the first prompt is not refused', async () => {
      const order: string[] = [];
      const { conversation } = await open({
        async *streamConversation() {
          order.push('stream open');
          yield asked(0, 'a1');
        },
        sendPrompt: () => {
          order.push('prompt sent');

          return entries(done(0, 'completed'));
        },
      });

      const { ended } = await conversation.watchApprovals({
        onApproval: () => undefined,
        signal: new AbortController().signal,
      });

      await sent(conversation);
      await ended;

      expect(order).toEqual(['stream open', 'prompt sent']);
    });

    it('ends quietly when it is stopped, and fails on any other error', async () => {
      const stop = new AbortController();
      const stopped = await open({
        async *streamConversation() {
          yield asked(0, 'a1');
          stop.abort();
          throw new Error('connection reset by the abort');
        },
      });
      const watching = await stopped.conversation.watchApprovals({
        onApproval: () => undefined,
        signal: stop.signal,
      });

      await expect(watching.ended).resolves.toBeUndefined();

      const failing = await open({
        async *streamConversation() {
          yield asked(0, 'a1');
          throw new Error('backend went away');
        },
      });
      const failed = await failing.conversation.watchApprovals({
        onApproval: () => undefined,
        signal: new AbortController().signal,
      });

      await expect(failed.ended).rejects.toThrow('backend went away');
    });

    it('answers an approval by its id with the decision', async () => {
      const { conversation, server } = await open({ answerApproval: () => undefined });

      await conversation.answerApproval({
        approval: approvalIdSchema.parse('a1'),
        response: { decision: 'skip_with_message', message: 'use ls instead' },
      });

      expect(server.calls.find(({ name }) => name === 'answerApproval')?.call).toEqual({
        params: { id: ID, approval: 'a1' },
        body: { response: { decision: 'skip_with_message', message: 'use ls instead' } },
      });
    });

    it('lets the caller tell that someone else answered first', async () => {
      const { conversation } = await open({
        answerApproval: () => ({ refuse: { status: 404, code: 'unknown_approval' } }),
      });

      await expect(
        conversation.answerApproval({
          approval: approvalIdSchema.parse('a1'),
          response: { decision: 'approve' },
        }),
      ).rejects.toMatchObject({ name: 'RefusedError', code: 'unknown_approval' });
    });
  });
});
