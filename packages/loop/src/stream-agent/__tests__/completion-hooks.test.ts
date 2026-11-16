import { expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import { historyMessageSchema } from '@sheavly/protocol/history/history.validator';
import { harnessNoticeSchema } from '@sheavly/protocol/notice/notice.validator';
import { answer } from '../../testing/summary-run.constants.js';
import { recording } from '../../testing/summary-run.fake.js';
import { runSession } from '../stream-agent.helper.js';

const context = {
  reason: 'Use the release findings',
  startedAt: 100,
  durationMs: 200,
  userMessagesSinceStart: 2,
  callId: 'release-call',
};
const task = {
  id: 'release-task',
  kind: 'agent',
  command: 'release review',
  description: 'Review the release',
  status: 'completed',
  startedAt: 100,
  endedAt: 300,
  output: 'Release findings',
};
const individual = [
  { kind: 'task-finished', task, context },
  {
    kind: 'agent-report',
    taskId: task.id,
    agent: {
      id: 'release-agent',
      parentId: 'parent',
      rootId: 'parent',
      depth: 2,
      startedByCall: context.callId,
      title: 'Release reviewer',
      state: 'completed',
      startedAt: 100,
      endedAt: 300,
    },
    outcome: 'completed',
    report: 'Release findings',
    context,
  },
];
const notices = [
  ...individual,
  { kind: 'tasks-finished', reason: context.reason, context, notices: individual },
];

it.each(notices)('shows hooks and the model the same completion pointers for %s', async (raw) => {
  const notice = harnessNoticeSchema.parse(raw);

  for (const keepCalls of [false, true]) {
    const { provider, requests } = recording([answer]);
    const messages = [
      historyMessageSchema.parse({ role: 'user', content: 'Review the release.', at: 1 }),
      historyMessageSchema.parse({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: context.callId, name: 'start_task', input: {} }],
        at: 100,
      }),
      historyMessageSchema.parse({
        role: 'tool',
        toolCallId: context.callId,
        content: 'Task started',
        isError: false,
        at: 101,
      }),
      historyMessageSchema.parse({ role: 'notice', notice, at: 300 }),
    ];
    const before = structuredClone(messages);
    const result = await runSession({
      provider,
      tools: [],
      messages,
      hooks: [
        defineHook({
          name: 'trim-starting-call',
          beforeModelCall: async ({ messages: input }) => {
            expect(input.at(-1)?.content).toContain('starting tool call ID release-call');

            return keepCalls ? [...input] : input.filter((message) => message.role === 'user');
          },
        }),
      ],
    });
    const sent = requests[0]?.messages;
    const containsCall = sent?.some(
      (message) => message.role === 'assistant' && message.toolCalls.length > 0,
    );
    const containsPointer = sent?.at(-1)?.content.includes('starting tool call ID release-call');

    expect(result.reason).toBe('completed');
    expect(containsCall).toBe(keepCalls);
    // The view is built once: a hook that drops the call leaves the pointer as plain data.
    expect(containsPointer).toBe(true);
    expect(sent?.at(-1)?.content).toContain(context.reason);
    expect(sent?.at(-1)?.content).toContain('user messages since start 2');
    expect(result.messages.slice(0, before.length)).toEqual(before);
    expect(result.messages[3]).toMatchObject({ notice });
  }
});
