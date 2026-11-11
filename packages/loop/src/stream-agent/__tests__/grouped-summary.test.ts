import { expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import { callIdSchema, summarySectionIdSchema } from '@sheavly/protocol/message/message.validator';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { createTaskTools } from '@sheavly/tools/tasks/tasks.tool';
import { until } from '@sheavly/testing/wait/until.fake';
import { history, probe, recording, toolTurn } from '../../testing/summary-run.fake.js';
import { answer } from '../../testing/summary-run.constants.js';
import { runSession } from '../stream-agent.helper.js';

it('delivers the group reason after its await_tasks call has been summarized out of the model view', async () => {
  const tasks = new TaskRegistry();
  const finish = Promise.withResolvers<undefined>();
  const members = ['first review', 'second review'].map((command) =>
    tasks.start({
      command,
      description: command,
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
  const { provider, requests } = recording([groupTurn, toolTurn(95_000), answer, answer]);
  const events: AgentEvent[] = [];
  let summaries = 0;

  try {
    const result = await runSession({
      tasks,
      provider,
      tools: [...createTaskTools(tasks), probe],
      messages: history(),
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
    expect(notices[0]).toMatchObject({ notice: { kind: 'tasks-finished', reason } });
    expect(result.messages.filter((message) => message.role === 'notice')).toHaveLength(1);
    expect(result.messages.filter((message) => message.role === 'summary')).toHaveLength(2);
  } finally {
    await tasks.cancelAll();
  }
});
