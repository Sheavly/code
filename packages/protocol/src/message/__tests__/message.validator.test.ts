import { describe, expect, it } from 'vitest';
import { messageSchema, summaryMessageSchema } from '../message.validator.js';
import { historyMessageSchema } from '../../history/history.validator.js';

const checkpoint = {
  role: 'summary',
  sections: [{ id: 'goal', title: 'Goal', body: 'Fix the invoice total.' }],
  kept: 12,
  summarized: 40,
  summarizer: 'model',
  at: 1,
};

describe('the summary message', () => {
  it('accepts a checkpoint with sections, a kept count and what wrote it', () => {
    expect(summaryMessageSchema.parse(checkpoint)).toEqual(checkpoint);
  });

  it('accepts a checkpoint with no sections and nothing newly summarized', () => {
    const empty = { ...checkpoint, sections: [], kept: 1, summarized: 0 };

    expect(summaryMessageSchema.parse(empty)).toEqual(empty);
  });

  it('refuses to keep nothing, since the latest user message is always kept', () => {
    expect(summaryMessageSchema.safeParse({ ...checkpoint, kept: 0 }).success).toBe(false);
  });

  it('refuses two sections with the same id', () => {
    const twice = {
      ...checkpoint,
      sections: [
        { id: 'goal', title: 'Goal', body: 'a' },
        { id: 'goal', title: 'Again', body: 'b' },
      ],
    };

    expect(summaryMessageSchema.safeParse(twice).success).toBe(false);
  });

  it('rejects a negative count, a section without an id, and a missing summarizer', () => {
    expect(summaryMessageSchema.safeParse({ ...checkpoint, kept: -1 }).success).toBe(false);
    expect(
      summaryMessageSchema.safeParse({
        ...checkpoint,
        sections: [{ id: '', title: 'x', body: 'y' }],
      }).success,
    ).toBe(false);

    const { summarizer: _removed, ...unnamed } = checkpoint;

    expect(summaryMessageSchema.safeParse(unnamed).success).toBe(false);
  });
});

describe('what a model is sent versus what is stored', () => {
  it('stores a checkpoint in history but never sends one: the model schema refuses it', () => {
    expect(historyMessageSchema.safeParse(checkpoint).success).toBe(true);
    expect(messageSchema.safeParse(checkpoint).success).toBe(false);
  });

  it('keeps the other roles in both, and refuses an unknown one', () => {
    for (const schema of [messageSchema, historyMessageSchema]) {
      expect(schema.safeParse({ role: 'user', content: 'hi' }).success).toBe(true);
      expect(schema.safeParse({ role: 'system', content: 'hi' }).success).toBe(false);
    }
  });
});
