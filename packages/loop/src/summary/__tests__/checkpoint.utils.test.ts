import { describe, expect, it } from 'vitest';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { summarySectionIdSchema } from '@sheavly/protocol/message/message.validator';
import { InvalidHistoryError } from '../../errors/loop.errors.js';
import { assertValidStoredHistory, buildCheckpoint } from '../checkpoint.utils.js';

const BIG = 'x'.repeat(800);
const user = (content = BIG): HistoryMessage => ({ role: 'user', content, at: 1 });
const reply = (): HistoryMessage => ({ role: 'assistant', content: BIG, toolCalls: [], at: 2 });
const body = { sections: [{ id: summarySectionIdSchema.parse('goal'), title: 'Goal', body: 's' }] };

function checkpointFor(params: { history: HistoryMessage[]; cut: number }) {
  return buildCheckpoint({ summarizer: 'test', body, ...params, at: 9 });
}

describe('checkpoint coverage', () => {
  it('records where a first checkpoint’s coverage ends, folding in nothing', () => {
    const history = [user(), reply(), user(), reply(), user()];
    const first = checkpointFor({ history, cut: 3 });

    expect(first.covered).toBe(3);
    expect(first.kept).toBe(2);
    expect(first.incorporated).toBeUndefined();
  });

  it('folds the previous checkpoint into the next, advancing from the beginning', () => {
    const base = [user(), reply(), user(), reply(), user()];
    const first = checkpointFor({ history: base, cut: 3 });
    const history = [...base, first, reply(), user(), reply(), user()];
    // The first checkpoint is at position 5; its successor covers further on, never less.
    const second = checkpointFor({ history, cut: 8 });

    expect(second.incorporated).toBe(5);
    expect(second.covered).toBe(8);
    expect(second.covered).toBeGreaterThan(first.covered);
    expect(() => assertValidStoredHistory([...history, second])).not.toThrow();
  });
});

describe('a stored history’s coverage', () => {
  const base = [user(), reply(), user(), reply(), user()];
  const first = checkpointFor({ history: base, cut: 3 });

  it('is accepted when each checkpoint ends where its tail begins', () => {
    expect(() => assertValidStoredHistory([...base, first])).not.toThrow();
  });

  it('refuses a checkpoint whose coverage does not match its tail', () => {
    const lying = { ...first, covered: 2 };

    expect(() => assertValidStoredHistory([...base, lying])).toThrow(InvalidHistoryError);
    expect(() => assertValidStoredHistory([...base, lying])).toThrow('covers 2 entries');
  });

  it('refuses a checkpoint that skips the one before it, or folds in the wrong one', () => {
    const history = [...base, first, reply(), user(), reply(), user()];
    const second = checkpointFor({ history, cut: 8 });
    const skipped = { ...second };

    delete skipped.incorporated;

    expect(() => assertValidStoredHistory([...history, skipped])).toThrow('skipped or taken twice');
    expect(() => assertValidStoredHistory([...history, { ...second, incorporated: 1 }])).toThrow(
      'skipped or taken twice',
    );
  });
});
