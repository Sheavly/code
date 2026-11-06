import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type { UsageTotals } from '@sheavly/protocol/usage/usage.types';

/** Cumulative reported usage, across a conversation's sessions. Sequence numbers prevent double counting. */
export class UsageLedger {
  #totals: UsageTotals = {
    throughSeq: -1,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUsd: 0,
    missingUsageCalls: 0,
    unpricedCalls: 0,
    incomplete: false,
  };

  constructor(initial?: UsageTotals) {
    if (initial) this.#totals = { ...initial };
  }

  get snapshot(): UsageTotals {
    return { ...this.#totals };
  }

  /** Ignores stale async refreshes; a newer backend snapshot includes everything through its seq. */
  update(snapshot: UsageTotals): void {
    if (snapshot.throughSeq >= this.#totals.throughSeq) this.#totals = { ...snapshot };
  }

  markIncomplete(): void {
    this.#totals.incomplete = true;
  }

  observe(entry: StreamEntry): void {
    if (entry.seq <= this.#totals.throughSeq) return;
    this.#totals.throughSeq = entry.seq;
    if (entry.kind !== 'event' || entry.event.type !== 'usage') return;

    const { tokens, estimatedCostUsd } = entry.event.usage;
    const totals = this.#totals;

    totals.calls += 1;
    totals.inputTokens += tokens?.inputTokens ?? 0;
    totals.outputTokens += tokens?.outputTokens ?? 0;
    totals.cacheReadTokens += tokens?.cacheReadTokens ?? 0;
    totals.cacheWriteTokens += tokens?.cacheWriteTokens ?? 0;
    totals.estimatedCostUsd += estimatedCostUsd ?? 0;
    if (tokens === null) totals.missingUsageCalls += 1;
    if (estimatedCostUsd === undefined) totals.unpricedCalls += 1;
  }
}
