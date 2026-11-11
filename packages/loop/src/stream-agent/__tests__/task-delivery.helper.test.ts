import { expect, it } from 'vitest';
import type { AgentEvent, AgentEventBody } from '@sheavly/protocol/event/event.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { until } from '@sheavly/testing/wait/until.fake';
import { OrderedQueue } from '../../queue/queue.service.js';
import { reportFinishedTasks } from '../task-delivery.helper.js';

it('preserves every whole report when a synchronous completion listener releases all delivered tasks', async () => {
  const registry = new SessionRegistry();
  const ref = registry.startMain({ title: 'Parent' });
  const tasks = new TaskRegistry();
  const reports = ['first', 'second', 'ungrouped'].map((label) =>
    `${label} findings\n`.repeat(1_000),
  );
  const members = reports.map((report, index) => {
    const callId = callIdSchema.parse(`child-${String(index)}`);
    const child = registry.startChild({
      parentId: ref.id,
      startedByCall: callId,
      title: `Review ${String(index)}`,
    });

    registry.end({ id: child.id, state: 'completed' });

    return tasks.start({
      command: 'review',
      description: 'Review',
      callId,
      sessionId: ref.id,
      run: async ({ onOutput }) => {
        onOutput(report);

        return { exitCode: 0, report };
      },
    });
  });

  tasks.group({ ids: members.slice(0, 2).map((task) => task.id), reason: 'Compare reviews' });
  await until(() => tasks.runningCount === 0);
  const released: AgentEvent[] = [];
  const events = new OrderedQueue<AgentEventBody>({
    onRelease: (event) => {
      released.push(event);
      if (event.type === 'task_completed') tasks.releaseFinished();
    },
  });
  const messages: HistoryMessage[] = [];

  reportFinishedTasks({ tasks, session: { registry, ref }, messages, events });
  const grouped = messages.find(
    (message) => message.role === 'notice' && message.notice.kind === 'tasks-finished',
  );
  const single = messages.find(
    (message) => message.role === 'notice' && message.notice.kind === 'agent-report',
  );

  expect(tasks.list()).toEqual([]);
  expect(
    grouped?.role === 'notice' &&
      grouped.notice.kind === 'tasks-finished' &&
      grouped.notice.notices,
  ).toMatchObject([
    {
      kind: 'agent-report',
      report: reports[0],
      context: { reason: 'Compare reviews', userMessagesSinceStart: 0 },
    },
    {
      kind: 'agent-report',
      report: reports[1],
      context: { reason: 'Compare reviews', userMessagesSinceStart: 0 },
    },
  ]);
  expect(single?.role === 'notice' && single.notice).toMatchObject({
    kind: 'agent-report',
    report: reports[2],
    context: { reason: 'Review', userMessagesSinceStart: 0 },
  });
  expect(released.filter((event) => event.type === 'task_completed')).toHaveLength(3);
  expect(released.filter((event) => event.type === 'harness_notice')).toHaveLength(2);
  expect(
    messages.filter((message) => message.role === 'notice').map((message) => message.notice),
  ).toEqual(
    released.filter((event) => event.type === 'harness_notice').map((event) => event.notice),
  );
});
