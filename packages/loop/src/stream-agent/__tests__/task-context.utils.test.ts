import { describe, expect, it } from 'vitest';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { historyMessageSchema } from '@sheavly/protocol/history/history.validator';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { taskCompletionContext } from '../task-context.utils.js';

const callId = callIdSchema.parse('launch');
const launch = historyMessageSchema.parse({
  role: 'assistant',
  content: '',
  toolCalls: [{ id: callId, name: 'start_task', input: {} }],
  at: 10,
});
const result = historyMessageSchema.parse({
  role: 'tool',
  toolCallId: callId,
  content: 'started',
  isError: false,
  at: 10,
});
const checkpoint = historyMessageSchema.parse({
  role: 'summary',
  sections: [{ id: 'goal', title: 'Goal', body: 'Continue investigating.' }],
  kept: 1,
  summarized: 3,
  summarizer: 'test',
  at: 30,
});
const user = (at?: number): HistoryMessage => ({
  role: 'user',
  content: 'Follow up',
  ...(at !== undefined && { at }),
});
const context = (history: HistoryMessage[]) =>
  taskCompletionContext({
    reason: 'Compare findings',
    startedAt: 10,
    endedAt: 25,
    history,
    callId,
  });

describe('taskCompletionContext', () => {
  it('retains the reason, duration and starting call while its assistant call remains visible', () => {
    expect(context([user(1), launch, result, user(20)])).toEqual({
      reason: 'Compare findings',
      startedAt: 10,
      durationMs: 15,
      userMessagesSinceStart: 1,
      callId,
    });
  });

  it('counts stored user entries after the start, including those replaced in the summary view', () => {
    const history = [user(1), launch, result, user(15), user(20), checkpoint, user(35)];

    expect(context(history)).toEqual({
      reason: 'Compare findings',
      startedAt: 10,
      durationMs: 15,
      userMessagesSinceStart: 3,
    });
    expect(history).toHaveLength(7);
    expect(history[1]).toBe(launch);
  });

  it('does not count untimed entries, earlier or same-time messages, tool output or notices', () => {
    const notice = historyMessageSchema.parse({
      role: 'notice',
      at: 21,
      notice: {
        kind: 'task-finished',
        task: {
          id: 'previous',
          command: 'probe',
          description: 'prior work',
          status: 'completed',
          output: '',
          startedAt: 1,
          endedAt: 2,
        },
      },
    });

    expect(context([user(), user(9), user(10), launch, result, notice, user(11)])).toMatchObject({
      userMessagesSinceStart: 1,
    });
  });

  it('never points at a tool result without a visible assistant call', () => {
    expect(context([user(1), result])).not.toHaveProperty('callId');
  });

  it('clamps a reversed clock and keeps an empty reason rather than guessing another request', () => {
    expect(taskCompletionContext({ reason: '', startedAt: 10, endedAt: 9, history: [] })).toEqual({
      reason: '',
      startedAt: 10,
      durationMs: 0,
      userMessagesSinceStart: 0,
    });
  });
});
