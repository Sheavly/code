import { afterEach, describe, expect, it } from 'vitest';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { createTaskTools } from '@sheavly/tools/tasks/tasks.tool';
import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';
import { until } from '@sheavly/testing/wait/until.fake';
import { runSession, streamAgent } from '../stream-agent.helper.js';
import { assertValidHistory } from '../../history/history.utils.js';
import { viewOf } from '../../summary/summary.utils.js';

const reason = 'Compare both reviews before deciding whether to ship the release.';
const registries: TaskRegistry[] = [];

afterEach(async () => {
  await Promise.all(registries.splice(0).map((tasks) => tasks.cancelAll()));
});

function registry() {
  const tasks = new TaskRegistry();

  registries.push(tasks);

  return tasks;
}

function controlledTask(tasks: TaskRegistry, label: string, backgroundKind?: 'task' | 'service') {
  const finish = Promise.withResolvers<undefined>();
  const ended = Promise.withResolvers<undefined>();
  let aborted = false;
  const task = tasks.start({
    command: label,
    description: label,
    ...(backgroundKind && { backgroundKind }),
    run: async ({ signal, onOutput }) => {
      signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          finish.resolve(undefined);
        },
        { once: true },
      );
      await finish.promise;
      onOutput(`${label} findings`);

      return { exitCode: 0 };
    },
  });
  const unobserve = tasks.observe(({ update }) => {
    if (update.type !== 'task_ended' || update.task.id !== task.id) return;

    ended.resolve(undefined);
    unobserve();
  });

  return {
    task,
    finish: async () => {
      finish.resolve(undefined);
      await ended.promise;
    },
    wasAborted: () => aborted,
  };
}

const say = (text: string): StreamEvent[] => [
  { type: 'text_delta', text },
  { type: 'done', stopReason: 'end_turn' },
];
const toolTurn = (name: string, input: Record<string, unknown>): StreamEvent[] => [
  {
    type: 'tool_call',
    call: { id: callIdSchema.parse(name), name, input: { description: name, ...input } },
  },
  { type: 'done', stopReason: 'tool_use' },
];

function recordingProvider(turns: (StreamEvent[] | (() => Promise<StreamEvent[]>))[]) {
  const requests: Message[][] = [];
  const provider: Provider = {
    async *stream({ messages }) {
      requests.push(messages);
      const turn = turns[requests.length - 1];

      if (!turn) throw new Error('Unexpected extra model turn');
      yield* typeof turn === 'function' ? await turn() : turn;
    },
  };

  return { provider, requests };
}

async function collect(stream: AsyncIterable<AgentEvent>, onEvent?: (event: AgentEvent) => void) {
  const events: AgentEvent[] = [];

  for await (const event of stream) {
    events.push(event);
    onEvent?.(event);
  }

  return events;
}

function groupedNotices(events: AgentEvent[]) {
  return events.filter(
    (event) => event.type === 'harness_notice' && event.notice.kind === 'tasks-finished',
  );
}

function expectValidDoneHistory(events: AgentEvent[]) {
  const done = events.at(-1);

  if (done?.type !== 'done') throw new Error('Expected a final done event');

  expect(() =>
    assertValidHistory({ messages: viewOf(done.messages), source: 'Grouped abort' }),
  ).not.toThrow();
}

function options(tasks: TaskRegistry, provider: Provider) {
  return {
    tasks,
    provider,
    tools: createTaskTools(tasks),
    messages: [{ role: 'user' as const, content: 'Review the release.' }],
  };
}

describe('grouped task delivery in the loop', () => {
  it('returns await_tasks immediately, holds the first finish and delivers one shared notice in requested order', async () => {
    const tasks = registry();
    const first = controlledTask(tasks, 'first');
    const last = controlledTask(tasks, 'last');
    const independent = Promise.withResolvers<undefined>();
    const events: AgentEvent[] = [];
    const { provider, requests } = recordingProvider([
      toolTurn('await_tasks', { ids: [last.task.id, first.task.id], reason }),
      async () => {
        await independent.promise;

        return say('Independent work is done.');
      },
      say('Both reviews received.'),
    ]);
    const running = collect(streamAgent(options(tasks, provider)), (event) => events.push(event));

    await until(() => events.some((event) => event.type === 'tool_result'));
    expect(tasks.list().map((task) => task.status)).toEqual(['running', 'running']);
    const result = events.find((event) => event.type === 'tool_result');

    expect(result?.message.role === 'tool' && result.message.isError).toBe(false);
    expect(result?.message.content).toContain(reason);
    await first.finish();
    expect(tasks.hasDeliveries()).toBe(false);
    expect(tasks.release(first.task.id)).toBe(false);
    expect(groupedNotices(events)).toHaveLength(0);
    expect(events.filter((event) => event.type === 'task_completed')).toHaveLength(0);
    independent.resolve(undefined);
    await until(() => tasks.settleWaiters === 1);
    await last.finish();
    const finished = await running;
    const notices = groupedNotices(finished);
    const done = finished.at(-1);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      notice: {
        kind: 'tasks-finished',
        reason,
        notices: [
          { kind: 'task-finished', task: { id: last.task.id, output: 'last findings' } },
          { kind: 'task-finished', task: { id: first.task.id, output: 'first findings' } },
        ],
      },
    });
    expect(
      done?.type === 'done' && done.messages.filter((message) => message.role === 'notice'),
    ).toEqual([
      expect.objectContaining({
        notice: notices[0]?.type === 'harness_notice' ? notices[0].notice : undefined,
      }),
    ]);
    expect(requests[2]?.at(-1)?.content).toContain(reason);
    expect(finished.map((event) => event.seq)).toEqual(finished.map((_, index) => index));
    expect(
      finished.filter((event) => event.type === 'task_completed').map((event) => event.task.id),
    ).toEqual([last.task.id, first.task.id]);
    expect(done).toMatchObject({ type: 'done', reason: 'completed' });
  });

  it('holds a mid-model-call group completion until the next turn boundary', async () => {
    const tasks = registry();
    const first = controlledTask(tasks, 'first');
    const last = controlledTask(tasks, 'last');

    tasks.group({ ids: [first.task.id, last.task.id], reason });
    const inFlight = Promise.withResolvers<undefined>();
    const finishTurn = Promise.withResolvers<undefined>();
    const { provider, requests } = recordingProvider([
      async () => {
        inFlight.resolve(undefined);
        await finishTurn.promise;

        return say('Finishing independent work.');
      },
      say('Use the combined reviews.'),
    ]);
    const observed: AgentEvent[] = [];
    const running = collect(streamAgent(options(tasks, provider)), (event) => observed.push(event));

    await inFlight.promise;
    await first.finish();
    await last.finish();
    expect(tasks.hasDeliveries()).toBe(true);
    expect(groupedNotices(observed)).toHaveLength(0);
    expect(requests[0]?.some((message) => message.content.includes(reason))).toBe(false);
    finishTurn.resolve(undefined);
    const events = await running;
    const boundary = events.findIndex((event) => event.type === 'turn_end');
    const delivery = events.findIndex((event) => event.type === 'task_completed');

    expect(delivery).toBeGreaterThan(boundary);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.at(-1)?.content).toContain(reason);
    expect(groupedNotices(events)).toHaveLength(1);
  });

  it('a followup wakes a waiting parent without cancelling or releasing held members', async () => {
    const tasks = registry();
    const first = controlledTask(tasks, 'first');
    const last = controlledTask(tasks, 'last');
    const sessions = new SessionRegistry();
    const ref = sessions.startMain({ title: 'Parent' });

    tasks.group({ ids: [first.task.id, last.task.id], reason });
    await first.finish();
    const { provider, requests } = recordingProvider([
      say('Waiting for both reviews.'),
      say('Handling the followup.'),
      say('Reviews received.'),
    ]);
    const events: AgentEvent[] = [];
    const running = collect(
      streamAgent({ ...options(tasks, provider), session: { registry: sessions, ref } }),
      (event) => events.push(event),
    );

    await until(() => tasks.settleWaiters === 1);
    sessions.send({ id: ref.id, from: 'user', content: 'Also check deployment safety.' });
    await until(() => requests.length === 2 && tasks.settleWaiters === 1);
    expect(requests[1]?.at(-1)?.content).toContain('Also check deployment safety.');
    expect(tasks.get(first.task.id)?.status).toBe('completed');
    expect(tasks.release(first.task.id)).toBe(false);
    expect(tasks.get(last.task.id)?.status).toBe('running');
    expect(last.wasAborted()).toBe(false);
    expect(groupedNotices(events)).toHaveLength(0);
    await last.finish();
    await running;
    expect(groupedNotices(events)).toHaveLength(1);
    expect(tasks.settleWaiters).toBe(0);
    expect(sessions.inboxWaiters(ref.id)).toBe(0);
  });

  it('cancelling a member does not release the group early and the combined notice retains cancellation', async () => {
    const tasks = registry();
    const first = controlledTask(tasks, 'cancelled review');
    const last = controlledTask(tasks, 'surviving review');

    tasks.group({ ids: [first.task.id, last.task.id], reason });
    const { provider } = recordingProvider([
      toolTurn('cancel_task', { id: first.task.id }),
      say('Waiting for the other review.'),
      say('One review was cancelled.'),
    ]);
    const events: AgentEvent[] = [];
    const running = collect(streamAgent(options(tasks, provider)), (event) => events.push(event));

    await until(() => tasks.settleWaiters === 1);
    expect(first.wasAborted()).toBe(true);
    expect(tasks.get(first.task.id)?.status).toBe('cancelled');
    expect(tasks.hasDeliveries()).toBe(false);
    expect(tasks.release(first.task.id)).toBe(false);
    expect(groupedNotices(events)).toHaveLength(0);
    await last.finish();
    await running;
    expect(groupedNotices(events)).toMatchObject([
      {
        notice: {
          kind: 'tasks-finished',
          reason,
          notices: [
            { kind: 'task-finished', task: { id: first.task.id, status: 'cancelled' } },
            { kind: 'task-finished', task: { id: last.task.id, status: 'completed' } },
          ],
        },
      },
    ]);
  });

  it('wakes a parked loop when retained completed tasks are grouped without another settlement', async () => {
    const tasks = registry();
    const completed = controlledTask(tasks, 'completed review');
    const blocker = controlledTask(tasks, 'ongoing review');

    await completed.finish();
    tasks.takeDeliveries();
    const { provider, requests } = recordingProvider([
      say('Independent work finished.'),
      say('Revisited the completed review.'),
      say('All work finished.'),
    ]);
    const running = collect(streamAgent(options(tasks, provider)));

    await until(() => tasks.settleWaiters === 1);
    tasks.group({ ids: [completed.task.id], reason });
    await until(() => requests.length === 2 && tasks.settleWaiters === 1);
    expect(requests[1]?.at(-1)?.content).toContain(reason);
    expect(tasks.get(blocker.task.id)?.status).toBe('running');
    await blocker.finish();
    const events = await running;

    expect(groupedNotices(events)).toHaveLength(1);
    expect(tasks.settleWaiters).toBe(0);
    expect(tasks.hasPendingTasks()).toBe(false);
  });

  it('services are exempt from automatic finite waiting', async () => {
    const tasks = registry();
    const finite = controlledTask(tasks, 'finite');
    const service = controlledTask(tasks, 'server', 'service');
    const { provider } = recordingProvider([
      say('Waiting for finite work.'),
      say('Finite work received.'),
    ]);
    const running = collect(streamAgent(options(tasks, provider)));

    await until(() => tasks.settleWaiters === 1);
    await finite.finish();
    const events = await running;

    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
    expect(tasks.get(service.task.id)?.status).toBe('running');
    expect(service.wasAborted()).toBe(false);
    expect(tasks.hasPendingTasks()).toBe(false);
  });

  it('abort cancels every grouped member and unrelated services before done', async () => {
    const tasks = registry();
    const first = controlledTask(tasks, 'first');
    const last = controlledTask(tasks, 'last');
    const service = controlledTask(tasks, 'server', 'service');
    const controller = new AbortController();

    tasks.group({ ids: [first.task.id, last.task.id], reason });
    const { provider } = recordingProvider([say('Waiting.')]);
    const running = collect(
      streamAgent({ ...options(tasks, provider), signal: controller.signal }),
    );

    await until(() => tasks.settleWaiters === 1);
    controller.abort();
    const events = await running;

    expect([first, last, service].map((task) => task.wasAborted())).toEqual([true, true, true]);
    expect(tasks.list().map((task) => task.status)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'interrupted' });
    expectValidDoneHistory(events);
    expect(groupedNotices(events)).toHaveLength(0);
    expect(tasks.settleWaiters).toBe(0);
  });

  it('aborting a grouped subagent cancels its running descendants', async () => {
    const tasks = registry();
    const sessions = new SessionRegistry();
    const ref = sessions.startMain({ title: 'Parent' });
    const descendantStarted = Promise.withResolvers<undefined>();
    const descendantStopped = Promise.withResolvers<undefined>();
    const controller = new AbortController();
    const childProvider: Provider = {
      async *stream({ messages, signal }) {
        if (messages[0]?.content === 'Review with a descendant') {
          if (messages.length === 1) {
            yield* toolTurn('start_agent', { title: 'Descendant', task: 'Nested review' });

            return;
          }

          yield* say('Waiting for my descendant.');

          return;
        }

        descendantStarted.resolve(undefined);
        signal.addEventListener('abort', () => descendantStopped.resolve(undefined), {
          once: true,
        });
        await descendantStopped.promise;
        yield { type: 'done', stopReason: 'end_turn' };
      },
    };
    const sibling = controlledTask(tasks, 'sibling');
    const { provider } = recordingProvider([
      toolTurn('start_agent', { title: 'Review', task: 'Review with a descendant' }),
      toolTurn('await_tasks', { ids: [sibling.task.id, 't2'], reason }),
      say('Waiting for the grouped review.'),
    ]);
    const running = collect(
      streamAgent({
        ...options(tasks, provider),
        signal: controller.signal,
        session: { registry: sessions, ref },
        tools: [
          ...createTaskTools(tasks),
          createSubAgentTool({
            sessions,
            tasks,
            provider: childProvider,
            runAgent: runSession,
            tools: [],
          }),
        ],
      }),
    );

    await descendantStarted.promise;
    await until(() => tasks.settleWaiters === 1);
    controller.abort();
    const events = await running;

    await descendantStopped.promise;
    expect(tasks.list().map((task) => task.status)).toEqual(['cancelled', 'cancelled']);
    expect(
      sessions
        .list()
        .filter((session) => session.depth > 0)
        .every((session) => session.state === 'interrupted'),
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'interrupted' });
    expectValidDoneHistory(events);
  });
});
