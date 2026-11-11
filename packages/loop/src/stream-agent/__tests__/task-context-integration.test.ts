import { expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import { answer } from '../../testing/summary-run.constants.js';
import { recording } from '../../testing/summary-run.fake.js';
import { runSession } from '../stream-agent.helper.js';

const clock = useFixedClock(1_000);

function controlledTask(tasks: TaskRegistry, description: string) {
  const finish = Promise.withResolvers<undefined>();
  const task = tasks.start({
    command: description,
    description,
    // No assistant call with this ID is in history: context must omit it.
    callId: callIdSchema.parse(description),
    run: async ({ signal, onOutput }) => {
      signal.addEventListener('abort', () => finish.resolve(undefined), { once: true });
      await finish.promise;
      onOutput(`${description} findings`);

      return { exitCode: 0 };
    },
  });

  return {
    task,
    finish: async () => {
      finish.resolve(undefined);
      await until(() => tasks.get(task.id)?.status === 'completed');
    },
  };
}

it('uses earliest start/latest end for a group but each member has its own timing and user count', async () => {
  const tasks = new TaskRegistry();
  const early = controlledTask(tasks, 'early');

  clock.advance(100);
  const late = controlledTask(tasks, 'late');
  const reason = 'Compare the two findings before selecting a fix.';

  tasks.group({ ids: [late.task.id, early.task.id], reason });
  const unrelated = controlledTask(tasks, 'unrelated');

  clock.advance(50);
  const { provider, requests } = recording([answer, answer]);
  const events: AgentEvent[] = [];

  try {
    // Its notice renders as a user at 1,150, but must not inflate the group counts.
    await unrelated.finish();
    const result = await runSession({
      tasks,
      provider,
      tools: [],
      // At 1,000 the early boundary is excluded; at 1,100 the late boundary is
      // excluded. Only the final user at 1,150 counts for the late task.
      messages: [
        { role: 'user', content: 'Start.', at: 1_000 },
        { role: 'user', content: 'Early followup.', at: 1_050 },
        { role: 'user', content: 'Late boundary.', at: 1_100 },
        { role: 'user', content: 'Both followup.', at: 1_150 },
      ],
      hooks: [
        defineHook({
          name: 'staggered-completion',
          afterTurn: async ({ turn }) => {
            if (turn !== 1) return;

            clock.advance(100); // Early ends at 1,250: duration 250.
            await early.finish();
            clock.advance(350); // Late ends at 1,600: duration 500; group spans 600.
            await late.finish();
          },
        }),
      ],
      onEvent: (event) => events.push(event),
    });
    const notice = events.find(
      (event) => event.type === 'harness_notice' && event.notice.kind === 'tasks-finished',
    );

    if (notice?.type !== 'harness_notice' || notice.notice.kind !== 'tasks-finished') {
      throw new Error('Expected grouped completion');
    }

    expect(notice.notice.context).toEqual({
      reason,
      startedAt: 1_000,
      durationMs: 600,
      userMessagesSinceStart: 3,
    });
    expect(notice.notice.notices.map((member) => member.context)).toEqual([
      { reason, startedAt: 1_100, durationMs: 500, userMessagesSinceStart: 1 },
      { reason, startedAt: 1_000, durationMs: 250, userMessagesSinceStart: 3 },
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.messages.at(-1)).toMatchObject({ role: 'user', at: 1_150 });
    expect(requests[0]?.messages.at(-1)?.content).toContain('unrelated findings');
    expect(result.reason).toBe('completed');
    expect(
      result.messages.find(
        (message) => message.role === 'notice' && message.notice.kind === 'tasks-finished',
      ),
    ).toMatchObject({ notice: notice.notice });
    expect(result.messages.filter((message) => message.role === 'notice')).toHaveLength(2);
  } finally {
    await tasks.cancelAll();
  }
});

it('delivers a simultaneous inbox followup before completion and includes it in messages-since', async () => {
  const tasks = new TaskRegistry();
  const task = controlledTask(tasks, 'review');
  const sessions = new SessionRegistry();
  const ref = sessions.startMain({ title: 'Review parent' });
  const { provider, requests } = recording([answer, answer]);
  const events: AgentEvent[] = [];

  try {
    const result = await runSession({
      tasks,
      provider,
      tools: [],
      session: { registry: sessions, ref },
      messages: [{ role: 'user', content: 'Review the release.', at: 1_000 }],
      hooks: [
        defineHook({
          name: 'simultaneous-followup-and-finish',
          afterTurn: async ({ turn }) => {
            if (turn !== 1) return;

            // Both become pending before the loop reaches its next turn boundary.
            clock.advance(200);
            sessions.send({ id: ref.id, from: 'user', content: 'Also check rollback safety.' });
            await task.finish();
            expect(sessions.hasMessages(ref.id)).toBe(true);
            expect(tasks.hasDeliveries()).toBe(true);
          },
        }),
      ],
      onEvent: (event) => events.push(event),
    });
    const received = events.findIndex((event) => event.type === 'message_received');
    const completed = events.findIndex((event) => event.type === 'task_completed');
    const notice = events.find(
      (event) => event.type === 'harness_notice' && event.notice.kind === 'task-finished',
    );

    expect(received).toBeGreaterThanOrEqual(0);
    expect(completed).toBeGreaterThan(received);
    expect(notice).toMatchObject({
      notice: {
        kind: 'task-finished',
        task: { id: task.task.id },
        context: { reason: 'review', startedAt: 1_000, durationMs: 200, userMessagesSinceStart: 1 },
      },
    });

    if (notice?.type !== 'harness_notice' || notice.notice.kind !== 'task-finished') {
      throw new Error('Expected single completion');
    }

    expect(notice.notice.context).not.toHaveProperty('callId');
    const next = requests[1]?.messages;

    expect(requests).toHaveLength(2);
    expect(next?.at(-2)).toMatchObject({ role: 'user', at: 1_200 });
    expect(next?.at(-2)?.content).toContain('Also check rollback safety.');
    expect(next?.at(-1)?.content).toContain('review findings');
    expect(result.messages.slice(-3, -1).map((message) => message.role)).toEqual([
      'user',
      'notice',
    ]);
    expect(result.reason).toBe('completed');
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
  } finally {
    await tasks.cancelAll();
  }
});
