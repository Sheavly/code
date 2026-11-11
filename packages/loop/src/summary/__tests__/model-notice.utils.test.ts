import { describe, expect, it } from 'vitest';
import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { historyMessageSchema } from '@sheavly/protocol/history/history.validator';
import { harnessNoticeSchema } from '@sheavly/protocol/notice/notice.validator';
import { withNoticeCallReferences } from '../model-notice.utils.js';
import { viewWithoutCallReferences } from '../summary.utils.js';

const context = {
  reason: 'Compare findings',
  startedAt: 10,
  durationMs: 10,
  userMessagesSinceStart: 1,
  callId: 'launch',
};
const notice = harnessNoticeSchema.parse({
  kind: 'task-finished',
  task: {
    id: 't1',
    command: 'review',
    description: 'Review',
    status: 'completed',
    startedAt: 10,
    endedAt: 20,
    output: 'Findings',
  },
  context,
});
const stored = historyMessageSchema.parse({ role: 'notice', notice, at: 20 });
const history: HistoryMessage[] = [
  { role: 'user', content: 'Review changes', at: 1 },
  historyMessageSchema.parse({
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'launch', name: 'start_task', input: {} }],
    at: 10,
  }),
  historyMessageSchema.parse({
    role: 'tool',
    toolCallId: 'launch',
    content: 'Started',
    isError: false,
    at: 11,
  }),
  stored,
];

describe('final model notice references', () => {
  it('starts without provisional pointers and restores them only when the final call is visible', () => {
    const source = viewWithoutCallReferences(history);
    const before = structuredClone(history);
    const final = withNoticeCallReferences({ history, source, messages: structuredClone(source) });

    expect(source.at(-1)?.content).not.toContain('starting tool call ID');
    expect(final.at(-1)?.content).toBe(formatHarnessNotice(notice));
    expect(history).toEqual(before);
    expect(source.at(-1)?.content).not.toContain('starting tool call ID');
  });

  it('leaves a trimmed final input pointer-free without erasing stored identities', () => {
    const source = viewWithoutCallReferences(history);
    const messages = source.filter((message) => message.role === 'user');
    const final = withNoticeCallReferences({ history, source, messages });

    expect(final).toBe(messages);
    expect(final.at(-1)?.content).not.toContain('starting tool call ID');
    expect(final.at(-1)?.content).toContain(context.reason);
    expect(notice).toHaveProperty('context.callId', 'launch');
  });

  it('never interprets a person’s identical text as a notice, even without a legacy message ID', () => {
    const source = viewWithoutCallReferences(history);
    const copied = source.at(-1)!;
    const ambiguousHistory: HistoryMessage[] = [...history, { ...copied, role: 'user' }];
    const ambiguousSource = viewWithoutCallReferences(ambiguousHistory);
    const final = withNoticeCallReferences({
      history: ambiguousHistory,
      source: ambiguousSource,
      messages: structuredClone(ambiguousSource),
    });

    expect(final).toEqual(ambiguousSource);
    expect(final.at(-1)?.content).toBe(copied.content);
    expect(final.at(-2)?.content).not.toContain('starting tool call ID');
  });

  it('does not overwrite edited hook text or assign pointers to an unrecognized entry', () => {
    const source = viewWithoutCallReferences(history);
    const messages = structuredClone(source).map((message) =>
      message.at === 20 ? { ...message, content: `Hook annotation\n${message.content}` } : message,
    );
    const final = withNoticeCallReferences({ history, source, messages });

    expect(final).toEqual(messages);
    expect(final.at(-1)?.content).toContain('Hook annotation');
    expect(final.at(-1)?.content).not.toContain('starting tool call ID');
  });
});
