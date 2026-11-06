import { describe, expect, it } from 'vitest';
import { UsageLedger } from '@sheavly/runtime/usage/usage.service';
import { usageText } from '../usage.utils.js';
import { statusText } from '../../tui/view.utils.js';

describe('usageText', () => {
  const empty = new UsageLedger().snapshot;

  it('shows unknown rather than zero before reported usage exists', () => {
    expect(usageText(empty)).toBe('tokens ?');
    expect(usageText({ ...empty, calls: 1, missingUsageCalls: 1 })).toBe('tokens ?');
  });

  it('formats reported totals with an estimate marker and USD cost', () => {
    expect(
      usageText({
        ...empty,
        calls: 1,
        inputTokens: 12_300,
        outputTokens: 456,
        estimatedCostUsd: 0.1234,
      }),
    ).toBe('12.3k in / 456 out · ~$0.1234');
    expect(usageText({ ...empty, calls: 1 })).toBe('0 in / 0 out · ~$0.0000');
  });

  it('uses the same metrics in the classic status line', () => {
    expect(
      statusText({
        info: {
          state: 'ready',
          model: 'Fast',
          mode: 'ask',
          tasks: 0,
          usage: { ...empty, calls: 1, inputTokens: 1230, outputTokens: 10 },
        },
      }),
    ).toContain('1.2k in / 10 out · ~$0.0000');
  });

  it('does not present partial usage or unpriced calls as complete billing', () => {
    expect(usageText({ ...empty, calls: 2, inputTokens: 2000, missingUsageCalls: 1 })).toBe(
      '≥2.0k in / 0 out',
    );
    expect(usageText({ ...empty, calls: 1, unpricedCalls: 1 })).toBe('0 in / 0 out');
    expect(usageText({ ...empty, calls: 1, incomplete: true, estimatedCostUsd: 0.1 })).toBe(
      '≥0 in / 0 out',
    );
  });
});
