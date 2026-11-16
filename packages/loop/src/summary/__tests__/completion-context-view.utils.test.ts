import { describe, expect, it } from 'vitest';
import { historyMessageSchema } from '@sheavly/protocol/history/history.validator';
import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { harnessNoticeSchema } from '@sheavly/protocol/notice/notice.validator';
import { viewOf } from '../summary.utils.js';

const start = historyMessageSchema.parse({
  role: 'assistant',
  content: '',
  toolCalls: [{ id: 'launch-reference', name: 'start_agent', input: {} }],
  at: 10,
});
const result = historyMessageSchema.parse({
  role: 'tool',
  toolCallId: 'launch-reference',
  content: 'started',
  isError: false,
  at: 11,
});
const task = {
  id: 't1',
  kind: 'agent',
  command: 'review',
  description: 'Review changes',
  status: 'completed',
  startedAt: 10,
  endedAt: 20,
  output: 'findings',
  callId: 'launch-reference',
};
const context = {
  reason: 'Choose a deployment strategy',
  startedAt: 10,
  durationMs: 10,
  userMessagesSinceStart: 2,
  callId: 'launch-reference',
};
const agent = {
  id: 'child',
  parentId: 'main',
  rootId: 'main',
  depth: 2,
  startedByCall: 'launch-reference',
  title: 'Review',
  state: 'completed',
  startedAt: 10,
  endedAt: 20,
};
const taskNotice = { kind: 'task-finished', task, context };
const agentNotice = {
  kind: 'agent-report',
  agent,
  taskId: task.id,
  outcome: 'completed',
  report: 'All findings',
  context,
};
const notices = [
  taskNotice,
  agentNotice,
  {
    kind: 'tasks-finished',
    reason: context.reason,
    context,
    notices: [taskNotice, agentNotice],
  },
];
const user: HistoryMessage = { role: 'user', content: 'Continue', at: 30 };
const checkpoint = historyMessageSchema.parse({
  role: 'summary',
  kept: 2,
  summarized: 2,
  covered: 2,
  sections: [{ id: 'goal', title: 'Goal', body: 'Continue reviewing.' }],
  summarizer: 'test',
  at: 40,
});

describe('completion context in a summary view', () => {
  it.each(notices)(
    'keeps a starting-call pointer when its assistant call is still visible: %s',
    (notice) => {
      const stored = historyMessageSchema.parse({ role: 'notice', notice, at: 21 });
      const view = viewOf([start, result, stored]);

      expect(view.at(-1)?.content).toContain('starting tool call ID launch-reference');
      expect(view.at(-1)?.content).toBe(formatHarnessNotice(harnessNoticeSchema.parse(notice)));
    },
  );

  it.each(notices)(
    'hides call pointers after a checkpoint without changing the stored snapshot: %s',
    (notice) => {
      const stored = historyMessageSchema.parse({ role: 'notice', notice, at: 21 });
      const history = [start, result, stored, user, checkpoint];
      const before = structuredClone(history);
      const shown = viewOf(history).find((message) => message.at === 21);

      expect(shown?.content).not.toContain('launch-reference');
      expect(shown?.content).toContain(context.reason);
      expect(shown?.content).toContain('user messages since start 2');
      expect(shown?.content).toContain('duration 10ms');
      expect(shown?.content).toContain('startedAt 10');
      expect(history).toEqual(before);
      expect(history[2]).toBe(stored);
    },
  );

  it('does not accept a tool result alone as a visible starting call', () => {
    const stored = historyMessageSchema.parse({ role: 'notice', notice: taskNotice, at: 21 });

    expect(viewOf([result, stored]).at(-1)?.content).not.toContain('launch-reference');
  });
});
