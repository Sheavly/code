import { describe, expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import {
  MAX_RUNNING_TASKS,
  MAX_RUNNING_TASK_TITLE_CHARS,
  MAX_RUNNING_TASK_REASON_CHARS,
} from '@sheavly/protocol/notice/notice.constants';
import { harnessNoticeSchema } from '@sheavly/protocol/notice/notice.validator';
import { callIdSchema, summarySectionIdSchema } from '@sheavly/protocol/message/message.validator';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { streamEntrySchema } from '@sheavly/protocol/stream/stream.validator';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import { createTaskTools } from '@sheavly/tools/tasks/tasks.tool';
import { history, probe, recording, toolTurn } from '../../testing/summary-run.fake.js';
import { answer, overflow } from '../../testing/summary-run.constants.js';
import { runSession } from '../stream-agent.helper.js';
import { runningTasksNotice } from '../running-tasks-notice.helper.js';
import { viewOf } from '../../summary/summary.utils.js';

const clock = useFixedClock(1_000);
const prompt = [{ role: 'user' as const, content: 'Continue the release.' }];
const summary = {
  summarizer: {
    name: 'test',
    summarize: async () => ({
      sections: [{ id: summarySectionIdSchema.parse('goal'), title: 'Goal', body: 'Release.' }],
    }),
  },
  policy: { keepTokens: 1, minFreeTokens: 100, freeShare: 0.1 },
};
const runningNotice = (request: ProviderRequest | undefined) =>
  request?.notices?.find((notice) => notice.kind === 'running-tasks');

function activeTask(params: {
  tasks: TaskRegistry;
  title: string;
  service?: boolean;
  sessionId?: SessionId;
}) {
  const { tasks, title, service, sessionId } = params;
  const exit = Promise.withResolvers<{ exitCode: number }>();
  const task = tasks.start({
    command: 'private command, not telemetry',
    description: title,
    sessionId,
    backgroundKind: service ? 'service' : 'task',
    run: ({ signal }) => {
      signal.addEventListener('abort', () => exit.resolve({ exitCode: 0 }), { once: true });

      return exit.promise;
    },
  });

  return {
    task,
    finish: async () => {
      exit.resolve({ exitCode: 0 });
      await until(() => tasks.get(task.id)?.status === 'completed');
    },
  };
}

function session() {
  const registry = new SessionRegistry();

  return { registry, ref: registry.startMain({ title: 'Release work' }) };
}

describe('bounded running-task snapshots', () => {
  it('omits the notice when there is no registry or no running work', () => {
    const { ref } = session();

    expect(runningTasksNotice({ tasks: undefined, sessionId: ref.id })).toBeUndefined();
    expect(runningTasksNotice({ tasks: new TaskRegistry(), sessionId: ref.id })).toBeUndefined();
  });

  it('keeps the newest tasks and caps each metadata field, without losing total or group identity', async () => {
    const tasks = new TaskRegistry();
    const { ref } = session();
    const title = 'title '.repeat(MAX_RUNNING_TASK_TITLE_CHARS);
    const reason = 'reason '.repeat(MAX_RUNNING_TASK_REASON_CHARS);
    const members = Array.from({ length: MAX_RUNNING_TASKS + 3 }, () => {
      clock.advance(1);

      return activeTask({ tasks, title }).task;
    });

    tasks.group({ ids: members.map((task) => task.id), reason });

    try {
      const notice = runningTasksNotice({ tasks, sessionId: ref.id });

      expect(notice).toBeDefined();
      expect(harnessNoticeSchema.parse(notice)).toEqual(notice);
      expect(notice?.total).toBe(members.length);
      expect(notice?.omitted).toBe(3);
      expect(notice?.tasks.map((task) => task.id)).toEqual(
        members
          .toReversed()
          .slice(0, MAX_RUNNING_TASKS)
          .map((task) => task.id),
      );
      expect(notice?.tasks.every((task) => task.group === members[0]?.id)).toBe(true);
      expect(
        notice?.tasks.every((task) => task.title.length === MAX_RUNNING_TASK_TITLE_CHARS),
      ).toBe(true);
      expect(
        notice?.tasks.every((task) => task.reason.length === MAX_RUNNING_TASK_REASON_CHARS),
      ).toBe(true);
      expect(notice?.tasks[0]?.title.endsWith('…')).toBe(true);
      expect(notice?.tasks[0]?.reason.endsWith('…')).toBe(true);
      expect(JSON.stringify(notice)).not.toContain('private command');
      expect(JSON.stringify(notice)).not.toContain('output');
      expect(tasks.get(members[0]!.id)?.description).toBe(title);
      expect(tasks.get(members[0]!.id)?.reason).toBe(reason);
    } finally {
      await tasks.cancelAll();
    }
  });

  it('uses registration order to select the newest tasks when timestamps tie', async () => {
    const tasks = new TaskRegistry();
    const { ref } = session();
    const members = Array.from(
      { length: MAX_RUNNING_TASKS + 1 },
      (_, index) => activeTask({ tasks, title: `Review ${index}`, service: true }).task,
    );

    try {
      const notice = runningTasksNotice({ tasks, sessionId: ref.id });

      expect(notice?.tasks[0]?.id).toBe(members.at(-1)?.id);
      expect(notice?.tasks.at(-1)?.id).toBe(members[1]?.id);
      expect(notice?.tasks).toHaveLength(MAX_RUNNING_TASKS);
      expect(notice?.omitted).toBe(1);
      expect(notice?.tasks[0]?.reason).toBe(`Review ${MAX_RUNNING_TASKS}`);
      expect(notice?.tasks[0]).not.toHaveProperty('group');
    } finally {
      await tasks.cancelAll();
    }
  });
});

it('uses the calling session to filter tasks before counting and selecting them', async () => {
  const tasks = new TaskRegistry();
  const caller = session().ref.id;
  const foreign = session().ref.id;
  const shared = activeTask({ tasks, title: 'Shared' });
  const owned = activeTask({ tasks, title: 'Owned', sessionId: caller });

  activeTask({ tasks, title: 'Foreign private work', sessionId: foreign });

  try {
    const notice = runningTasksNotice({ tasks, sessionId: caller });

    expect(notice?.total).toBe(2);
    expect(notice?.tasks.map((task) => task.id)).toEqual([owned.task.id, shared.task.id]);
    expect(JSON.stringify(notice)).not.toContain('Foreign');
  } finally {
    await tasks.cancelAll();
  }
});

it.each([
  { title: '', reason: '' },
  {
    title: 'x'.repeat(MAX_RUNNING_TASK_TITLE_CHARS),
    reason: 'x'.repeat(MAX_RUNNING_TASK_REASON_CHARS),
  },
])(
  'preserves valid metadata exactly at the empty and maximum boundaries',
  async ({ title, reason }) => {
    const tasks = new TaskRegistry();
    const member = activeTask({ tasks, title });

    tasks.group({ ids: [member.task.id], reason });

    try {
      const notice = runningTasksNotice({ tasks, sessionId: session().ref.id });

      expect(harnessNoticeSchema.parse(notice)).toEqual(notice);
      expect(notice?.tasks[0]?.title).toBe(title);
      expect(notice?.tasks[0]?.reason).toBe(reason);
    } finally {
      await tasks.cancelAll();
    }
  },
);

it('sends each live snapshot to both model and UI, never history, and stops when work finishes', async () => {
  const tasks = new TaskRegistry();
  const review = activeTask({ tasks, title: 'Live release review' });
  const run = session();
  const { provider, requests } = recording([toolTurn(100), toolTurn(100), answer]);
  const events: AgentEvent[] = [];
  const live: StreamEntry[] = [];
  const hookInputs: unknown[] = [];
  const unsubscribe = run.registry.subscribeEntries((entry) => live.push(entry), { replay: true });

  try {
    const result = await runSession({
      provider,
      tasks,
      session: run,
      tools: [probe],
      messages: prompt,
      instructions: 'Stable system instructions.',
      hooks: [
        defineHook({
          name: 'finish-review',
          beforeModelCall: async ({ messages }) => {
            hookInputs.push(messages);

            return messages;
          },
          afterTurn: async ({ turn }) => {
            if (turn === 2) await review.finish();
          },
        }),
      ],
      onEvent: (event) => events.push(event),
    });
    const snapshots = requests.flatMap((request) => {
      const notice = runningNotice(request);

      return notice ? [notice] : [];
    });
    const notices = events.filter(
      (event) => event.type === 'harness_notice' && event.notice.kind === 'running-tasks',
    );

    expect(requests).toHaveLength(3);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toEqual(snapshots[1]);
    expect(snapshots[0]).toMatchObject({
      total: 1,
      omitted: 0,
      tasks: [{ id: review.task.id, title: 'Live release review', startedAt: 1_000 }],
    });
    expect(runningNotice(requests[2])).toBeUndefined();
    expect(notices.map((event) => event.type === 'harness_notice' && event.notice)).toEqual(
      snapshots,
    );
    expect(
      requests.every((request) => request.instructions === 'Stable system instructions.'),
    ).toBe(true);
    expect(
      JSON.stringify([result.messages, requests.map((request) => request.messages), hookInputs]),
    ).not.toContain('running-tasks');
    expect(events.find((event) => event.type === 'done')).toMatchObject({
      messages: result.messages,
    });
    expect(
      result.messages.some(
        (message) => message.role === 'notice' && message.notice.kind === 'task-finished',
      ),
    ).toBe(true);
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
    expect(
      events.findIndex(
        (event) => event.type === 'harness_notice' && event.notice.kind === 'running-tasks',
      ),
    ).toBeLessThan(events.findIndex((event) => event.type === 'tool_call_started'));

    for (const entry of live) {
      expect(streamEntrySchema.parse(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
    }

    const replay: StreamEntry[] = [];
    const stopReplay = run.registry.subscribeEntries((entry) => replay.push(entry), {
      replay: true,
    });

    stopReplay();
    expect(replay).toEqual(live);
  } finally {
    unsubscribe();
    await tasks.cancelAll();
  }
});

it('coexists with context and output recovery notices while a service runs', async () => {
  const tasks = new TaskRegistry();
  const service = activeTask({ tasks, title: 'Watch release logs', service: true });
  const { provider, requests } = recording([
    [
      { type: 'text_delta', text: 'Partial' },
      { type: 'done', stopReason: 'max_tokens' },
    ],
    answer,
  ]);

  try {
    const result = await runSession({ provider, tasks, tools: [], messages: prompt });

    expect(result.reason).toBe('completed');
    expect(requests[0]?.notices?.map((notice) => notice.kind)).toEqual([
      'context-usage',
      'running-tasks',
    ]);
    expect(requests[1]?.notices?.map((notice) => notice.kind)).toEqual([
      'context-usage',
      'output-continuation',
      'running-tasks',
    ]);
    expect(runningNotice(requests[1])?.tasks[0]?.id).toBe(service.task.id);
    expect(JSON.stringify(result.messages)).not.toContain('running-tasks');
  } finally {
    await tasks.cancelAll();
  }
});

it('rebuilds running tasks for a retry after an overflow summary', async () => {
  const tasks = new TaskRegistry();
  const service = activeTask({ tasks, title: 'Watch release logs' });
  const { provider, requests } = recording([overflow, answer]);
  // A grouped finite task holds the run open, so the run is asked to yield once it is grouped.
  const yielding = new AbortController();

  try {
    await runSession({
      provider,
      tasks,
      tools: [],
      messages: history(),
      summary,
      yieldSignal: yielding.signal,
      hooks: [
        defineHook({
          name: 'group-during-summary',
          afterSummary: async () => {
            tasks.group({ ids: [service.task.id], reason: 'Watch for rollback errors.' });
            yielding.abort();
          },
        }),
      ],
    });

    expect(requests).toHaveLength(2);
    expect(runningNotice(requests[0])?.tasks[0]?.reason).toBe('Watch release logs');
    expect(runningNotice(requests[1])?.tasks[0]).toMatchObject({
      reason: 'Watch for rollback errors.',
      group: service.task.id,
    });
  } finally {
    await tasks.cancelAll();
  }
});

it('keeps the task reason visible across a summary between its start and completion', async () => {
  const tasks = new TaskRegistry();
  const review = activeTask({ tasks, title: 'Check deployment safety' });
  const reason = 'Choose whether this release is safe after the review completes.';
  const startingCall = {
    id: callIdSchema.parse('start-review'),
    name: 'start_task',
    input: { description: 'Start review' },
  };
  const { provider, requests } = recording([
    [
      {
        type: 'tool_call',
        call: {
          id: callIdSchema.parse('group-review'),
          name: 'await_tasks',
          input: { description: 'Wait for review', ids: [review.task.id], reason },
        },
      },
      ...toolTurn(95_000).filter((event) => event.type === 'done'),
    ],
    toolTurn(95_000),
    answer,
    answer,
  ]);
  const summarized: unknown[] = [];
  let summaries = 0;

  try {
    const result = await runSession({
      provider,
      tasks,
      tools: [...createTaskTools(tasks), probe],
      messages: [
        { role: 'user', content: 'Start a review.' },
        { role: 'assistant', content: '', toolCalls: [startingCall] },
        { role: 'tool', content: 'Review started.', toolCallId: startingCall.id, isError: false },
        ...history(),
      ],
      summary: {
        ...summary,
        summarizer: {
          name: 'recording-summary',
          summarize: async (input) => {
            summarized.push(input.messages);

            return summary.summarizer.summarize();
          },
        },
      },
      hooks: [
        defineHook({
          name: 'finish-after-summarized-call',
          afterSummary: async () => {
            summaries += 1;
          },
          afterTurn: async ({ turn }) => {
            if (turn === 3) await review.finish();
          },
        }),
      ],
    });

    expect(summaries).toBe(2);
    expect(requests).toHaveLength(4);
    expect(
      requests[2]?.messages.some(
        (message) =>
          message.role === 'assistant' &&
          message.toolCalls.some(
            (call) => call.id === startingCall.id || call.id === 'group-review',
          ),
      ),
    ).toBe(false);
    expect(JSON.stringify(requests[2]?.messages)).not.toContain(reason);
    expect(runningNotice(requests[2])?.tasks).toEqual([
      {
        id: review.task.id,
        title: 'Check deployment safety',
        reason,
        startedAt: 1_000,
        group: review.task.id,
      },
    ]);
    expect(runningNotice(requests[3])).toBeUndefined();
    expect(JSON.stringify([summarized, result.messages, viewOf(result.messages)])).not.toContain(
      'running-tasks',
    );
    expect(JSON.stringify(summarized)).not.toContain('Check deployment safety');
    expect(result.messages.some((message) => message.role === 'summary')).toBe(true);
    expect(result.reason).toBe('completed');
  } finally {
    await tasks.cancelAll();
  }
});
