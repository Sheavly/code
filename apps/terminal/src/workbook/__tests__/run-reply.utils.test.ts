import { describe, expect, it } from 'vitest';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { finalAnswer, runReply } from '../workbook.utils.js';

const at = 0;
const user = (content: string): HistoryMessage => ({ role: 'user', content, at });
const assistant = (content: string): HistoryMessage => ({
  role: 'assistant',
  content,
  toolCalls: [],
  at,
});

describe('runReply', () => {
  it('joins every assistant reply since the prompt, in order', () => {
    const run = [user('start'), assistant('Started both.'), assistant('Both finished: OK.')];

    expect(runReply(run)).toBe('Started both.\n\nBoth finished: OK.');
  });

  it('keeps what an earlier reply said when a later one is only a short wrap-up', () => {
    const run = [
      user('start'),
      assistant('Intruder said: No task with id t1. PARENT_STILL_RUNNING'),
      assistant('Task t1 has now finished.'),
    ];

    expect(runReply(run)).toContain('PARENT_STILL_RUNNING');
    expect(finalAnswer(run)).not.toContain('PARENT_STILL_RUNNING');
  });

  it('starts after the latest request, so an earlier prompt of a continued run is left out', () => {
    const run = [
      user('first'),
      assistant('about first'),
      user('second'),
      assistant('about second'),
    ];

    expect(runReply(run)).toBe('about second');
  });

  it('skips empty replies, such as one that only called tools', () => {
    expect(runReply([user('go'), assistant(''), assistant('done')])).toBe('done');
  });

  it('is empty when nothing was said', () => {
    expect(runReply([user('go')])).toBe('');
    expect(runReply([])).toBe('');
  });
});
