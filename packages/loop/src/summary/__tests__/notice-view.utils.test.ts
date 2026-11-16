import { describe, expect, it } from 'vitest';
import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { historyMessageSchema } from '@sheavly/protocol/history/history.validator';
import { chooseCut, estimateTokens, pinnedBefore, viewOf } from '../summary.utils.js';

const notice = historyMessageSchema.parse({
  role: 'notice',
  at: 7,
  notice: {
    kind: 'task-finished',
    context: { reason: 'Compare', startedAt: 10, durationMs: 10, userMessagesSinceStart: 1 },
    task: {
      id: 't1',
      kind: 'task',
      command: 'ls',
      description: 'listing',
      status: 'completed',
      exitCode: 0,
      startedAt: 1,
      endedAt: 2,
      output: 'a\nb',
    },
  },
});
const user = (content: string, id?: string): HistoryMessage =>
  historyMessageSchema.parse({ role: 'user', content, ...(id && { id }), at: 1 });

describe('a stored notice in the model view', () => {
  it('becomes a user-role message holding its formatted text, stamped as it was', () => {
    const view = viewOf([user('go'), notice]);
    const stored = notice.role === 'notice' ? notice.notice : undefined;

    expect(stored).toBeDefined();
    expect(view).toHaveLength(2);
    expect(view[1]).toEqual({ role: 'user', content: formatHarnessNotice(stored!), at: 7 });
  });

  it('carries no id, so it is never taken for a prompt a person typed', () => {
    const [, shown] = viewOf([user('go'), notice]);

    expect(shown && 'id' in shown).toBe(false);
  });

  it('leaves the stored history as it was', () => {
    const history = [user('go'), notice];

    viewOf(history);

    expect(history[1]).toBe(notice);
    expect(history[1]?.role).toBe('notice');
  });

  it('is counted by its formatted text when sizing a tail', () => {
    expect(estimateTokens(notice)).toBeGreaterThan(20);
  });

  it('is never pinned as the latest prompt: only the person’s own messages are', () => {
    const prompt = user('the request', '2f5b1a7e-8a3c-4c43-a3d0-5f1d0d7f2b10');
    const latest = user('and then this');
    const history: HistoryMessage[] = [
      prompt,
      ...Array.from({ length: 6 }, () => notice),
      latest,
      notice,
    ];
    const pinned = pinnedBefore({ history, start: history.length });

    // The typed prompt and the latest user message, in order; a notice after the latest user
    // message does not take its place, though the model is sent it as a user-role message.
    expect(pinned).toEqual([prompt, latest]);
  });

  it('never leaves a tail that starts on a result whose call was summarized, notice between them', () => {
    const call = historyMessageSchema.parse({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c1', name: 'read_file', input: {} }],
      at: 2,
    });
    const result = historyMessageSchema.parse({
      role: 'tool',
      toolCallId: 'c1',
      content: 'r'.repeat(400),
      isError: false,
      at: 3,
    });
    const history: HistoryMessage[] = [user('go'), user('again'), call, notice, result];

    for (const keepTokens of [1, 10, 50, 150]) {
      for (const maxTailTokens of [undefined, 1, 60]) {
        const cut = chooseCut({ history, keepTokens, maxTailTokens });

        // The call is at 2 and its result at 4: the cut keeps both (at or before the call) or
        // neither (after the result), never the result alone.
        if (cut !== undefined) expect(cut <= 2 || cut > 4).toBe(true);
      }
    }
  });

  it('is summarized like any older message, since it is a plain entry before the cut', () => {
    const history: HistoryMessage[] = [user('go'), notice, notice, user('y'.repeat(2_000))];

    expect(chooseCut({ history, keepTokens: 100 })).toBeGreaterThan(0);
  });
});
