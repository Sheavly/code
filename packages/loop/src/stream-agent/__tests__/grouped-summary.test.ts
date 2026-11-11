import { expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { callIdSchema, summarySectionIdSchema } from '@sheavly/protocol/message/message.validator';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { createTaskTools } from '@sheavly/tools/tasks/tasks.tool';
import { until } from '@sheavly/testing/wait/until.fake';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { viewOf } from '../../summary/summary.utils.js';

import { history, probe, recording, toolTurn } from '../../testing/summary-run.fake.js';
import { answer } from '../../testing/summary-run.constants.js';
import { runSession } from '../stream-agent.helper.js';

const clock = useFixedClock(1_000);

it('delivers the group reason after its await_tasks call has been summarized out of the model view', async () => {
  const tasks = new TaskRegistry();
  const finish = Promise.withResolvers<undefined>();
  const startingCall = {
    id: callIdSchema.parse('start-reviews'),
    name: 'start_task',
    input: { description: 'Start release reviews' },
  };
  const members = ['first review', 'second review'].map((command) =>
    tasks.start({
      command,
      description: command,
      callId: startingCall.id,
      run: async ({ signal, onOutput }) => {
        signal.addEventListener('abort', () => finish.resolve(undefined), { once: true });
        await finish.promise;
        onOutput(`${command} findings`);

        return { exitCode: 0 };
      },
    }),
  );
  const reason = 'Compare the deployment reviews before choosing the release strategy.';
  const groupTurn: StreamEvent[] = [
    {
      type: 'tool_call',
      call: {
        id: callIdSchema.parse('group'),
        name: 'await_tasks',
        input: {
          description: 'Group release reviews',
          ids: members.map((task) => task.id),
          reason,
        },
      },
    },
    {
      type: 'done',
      stopReason: 'tool_use',
      usage: {
        tokens: {
          inputTokens: 95_000,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
    },
  ];
  // Tasks start at 1,000. The equal-time user is excluded; the users at 1,100 and
  // 1,200 count even after compaction. The untimed legacy user cannot be counted.
  const messages: HistoryMessage[] = history().map((message, index) => ({
    ...message,
    at: 1_000 + index * 50,
  }));

  messages.splice(
    1,
    0,
    { role: 'assistant', content: '', toolCalls: [startingCall], at: 1_000 },
    {
      role: 'tool',
      content: 'Reviews started.',
      toolCallId: startingCall.id,
      isError: false,
      at: 1_000,
    },
  );
  const initialHistory = [{ role: 'user' as const, content: 'Legacy request.' }, ...messages];
  const { provider, requests } = recording([groupTurn, toolTurn(95_000), answer, answer]);
  const events: AgentEvent[] = [];
  let summaries = 0;

  try {
    const result = await runSession({
      tasks,
      provider,
      tools: [...createTaskTools(tasks), probe],
      messages: initialHistory,
      summary: {
        summarizer: {
          name: 'test',
          summarize: async () => ({
            sections: [
              {
                id: summarySectionIdSchema.parse('goal'),
                title: 'Goal',
                body: 'Release work continues.',
              },
            ],
          }),
        },
        policy: { keepTokens: 1, minFreeTokens: 100, freeShare: 0.1 },
      },
      hooks: [
        defineHook({
          name: 'finish-after-checkpoint',
          afterSummary: async () => {
            summaries += 1;
            if (summaries !== 2) return;

            expect(tasks.hasDeliveries()).toBe(false);
            clock.advance(500);
            finish.resolve(undefined);
            await until(() => tasks.hasDeliveries());
          },
        }),
      ],
      onEvent: (event) => events.push(event),
    });
    const notices = events.filter(
      (event) => event.type === 'harness_notice' && event.notice.kind === 'tasks-finished',
    );

    expect(result.reason).toBe('completed');
    expect(summaries).toBe(2);
    expect(requests[2]?.messages.some((message) => message.content.includes(reason))).toBe(false);
    expect(requests[3]?.messages.at(-1)?.content).toContain(reason);
    expect(notices).toHaveLength(1);
    const context = { reason, startedAt: 1_000, durationMs: 500, userMessagesSinceStart: 2 };

    expect(notices[0]).toMatchObject({
      notice: {
        kind: 'tasks-finished',
        reason,
        context,
        notices: members.map((task) => ({ kind: 'task-finished', task: { id: task.id }, context })),
      },
    });

    if (notices[0]?.type !== 'harness_notice' || notices[0].notice.kind !== 'tasks-finished') {
      throw new Error('Expected grouped completion');
    }

    expect(notices[0].notice.context).toEqual(context);
    expect(notices[0].notice.notices.map((notice) => notice.context)).toEqual([context, context]);
    expect(
      requests[0]?.messages.some(
        (message) =>
          message.role === 'assistant' &&
          message.toolCalls.some((call) => call.id === startingCall.id),
      ),
    ).toBe(true);
    expect(
      requests[3]?.messages.some(
        (message) =>
          message.role === 'assistant' &&
          message.toolCalls.some((call) => call.id === startingCall.id),
      ),
    ).toBe(false);
    const visibleUsers = viewOf(result.messages).filter((message) => message.role === 'user');

    // The checkpoint and notice render as users, alongside the pinned latest user.
    // The user at 1,100 is gone from the view but still contributes to the stored count.
    expect(visibleUsers).toHaveLength(3);
    expect(visibleUsers.some((message) => message.at === 1_100)).toBe(false);
    expect(visibleUsers.some((message) => message.at === 1_200)).toBe(true);
    expect(result.messages.filter((message) => message.role === 'user')).toHaveLength(4);
    expect(
      result.messages.find(
        (message) =>
          message.role === 'assistant' &&
          message.toolCalls.some((call) => call.id === startingCall.id),
      ),
    ).toBeDefined();
    expect(result.messages.filter((message) => message.role === 'notice')).toHaveLength(1);
    expect(result.messages.filter((message) => message.role === 'summary')).toHaveLength(2);
  } finally {
    await tasks.cancelAll();
  }
});
