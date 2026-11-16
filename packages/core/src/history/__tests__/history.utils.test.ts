import { describe, expect, it } from 'vitest';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { historyMessageSchema } from '@sheavly/protocol/history/history.validator';
import { messageIdSchema } from '@sheavly/protocol/message/message.validator';
import { latestPromptIndex, latestRequest, latestRequestIndex } from '../history.utils.js';

const typed: HistoryMessage = {
  role: 'user',
  id: messageIdSchema.parse('11111111-1111-4111-8111-111111111111'),
  content: 'do it',
};
const context: HistoryMessage = { role: 'user', content: 'extra context' };
const notice = historyMessageSchema.parse({
  role: 'notice',
  at: 7,
  notice: {
    kind: 'task-finished',
    task: {
      output: 'all green',
      status: 'completed',
      id: 't9',
      description: 'running the suite',
      kind: 'task',
      command: 'npm test',
      exitCode: 0,
      endedAt: 40,
      startedAt: 30,
    },
    context: { reason: 'tests', startedAt: 30, durationMs: 10, userMessagesSinceStart: 0 },
  },
});
const reply: HistoryMessage = { role: 'assistant', content: 'ok', toolCalls: [] };

describe('latestRequest', () => {
  it('is not moved by a notice or a reply that follows it', () => {
    const history = [typed, reply, notice];

    expect(latestRequestIndex(history)).toBe(0);
    expect(latestRequest(history)).toBe(typed);
  });

  it('finds the last user entry, with or without an id', () => {
    const history = [typed, reply, context];

    expect(latestRequestIndex(history)).toBe(2);
    expect(latestPromptIndex(history)).toBe(0);
  });

  it('reports nothing for a history without a request', () => {
    expect(latestRequestIndex([notice, reply])).toBe(-1);
    expect(latestPromptIndex([notice, reply])).toBe(-1);
    expect(latestRequest([notice])).toBeUndefined();
  });
});
