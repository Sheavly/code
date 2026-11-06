import { describe, expect, it } from 'vitest';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { UsageLedger } from '../usage.service.js';

function entry(seq: number, priced = true, missing = false): StreamEntry {
  return {
    seq,
    at: 0,
    sessionId: sessionIdSchema.parse(seq === 0 ? 'main' : 'child'),
    kind: 'event',
    event: {
      seq,
      type: 'usage',
      usage: {
        tokens: missing
          ? null
          : { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 0 },
        ...(priced && { estimatedCostUsd: 0.01 }),
      },
    },
  };
}

describe('UsageLedger', () => {
  it('adds usage across sessions once and rejects stale snapshot refreshes', () => {
    const ledger = new UsageLedger();

    ledger.observe(entry(0));
    const old = ledger.snapshot;

    ledger.observe(entry(1));
    ledger.observe(entry(1));
    ledger.update(old);
    expect(ledger.snapshot).toMatchObject({
      calls: 2,
      inputTokens: 200,
      outputTokens: 40,
      cacheReadTokens: 100,
      estimatedCostUsd: 0.02,
      throughSeq: 1,
    });
    expect(new UsageLedger(ledger.snapshot).snapshot).toEqual(ledger.snapshot);
  });

  it('distinguishes missing usage and prices from explicit free usage', () => {
    const ledger = new UsageLedger();

    ledger.observe(entry(0, false));
    ledger.observe(entry(1, false, true));
    ledger.markIncomplete();
    expect(ledger.snapshot).toMatchObject({
      calls: 2,
      missingUsageCalls: 1,
      unpricedCalls: 2,
      inputTokens: 100,
      incomplete: true,
    });
  });
});
