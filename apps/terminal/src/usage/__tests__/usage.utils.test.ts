import { describe, expect, it } from 'vitest';
import { UsageLedger } from '@sheavly/runtime/usage/usage.service';
import { usageText } from '../usage.utils.js';
import { statusText } from '../../tui/view.utils.js';

describe('usageText', () => {
  const empty = new UsageLedger().snapshot;
  const context = { throughSeq: 1, used: 12_756, window: 1_000_000 };

  it('shows unknown context instead of zero or cumulative billing tokens', () => {
    expect(usageText({ context: undefined, usage: empty })).toBe('context ?');
    expect(usageText({ context: { throughSeq: 1, window: 300_000 }, usage: undefined })).toBe(
      'context ? / 300K',
    );
    expect(usageText({ context: { throughSeq: 1, window: 1_000_000 }, usage: undefined })).toBe(
      'context ? / 1M',
    );
    expect(usageText({ context: { throughSeq: 1, used: 42 }, usage: undefined })).toBe(
      'context 42',
    );
  });

  it('formats the latest context against its window and keeps cumulative cost separate', () => {
    expect(
      usageText({
        context,
        usage: { ...empty, calls: 20, inputTokens: 1_200_000, estimatedCostUsd: 0.1234 },
      }),
    ).toBe('context 12.8k / 1M (1%) · ~$0.1234');
    expect(usageText({ context: { ...context, used: 0 }, usage: undefined })).toBe(
      'context 0 / 1M (0%)',
    );
  });

  it('uses the same context metrics in the classic status line', () => {
    expect(
      statusText({
        info: {
          state: 'ready',
          model: 'Fast',
          mode: 'ask',
          tasks: 0,
          contextUsage: context,
          usage: { ...empty, calls: 1 },
        },
      }),
    ).toContain('context 12.8k / 1M (1%) · ~$0.0000');
  });

  it.each([
    { ...empty, calls: 2, missingUsageCalls: 1 },
    { ...empty, calls: 1, unpricedCalls: 1 },
    { ...empty, calls: 1, incomplete: true, estimatedCostUsd: 0.1 },
  ])('omits incomplete or unknown billing without hiding context', (usage) => {
    expect(usageText({ context, usage })).toBe('context 12.8k / 1M (1%)');
  });
});
