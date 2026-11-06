import type { UsageTotals } from '@sheavly/protocol/usage/usage.types';

function tokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;

  return `${(value / 1_000_000).toFixed(1)}m`;
}

/** Reported totals, not context-window estimates. Unknown billing never looks like a free call. */
export function usageText(usage: UsageTotals): string {
  if (usage.calls === 0 || usage.calls === usage.missingUsageCalls) return 'tokens ?';

  const partial = usage.incomplete || usage.missingUsageCalls > 0;
  const counts = `${partial ? '≥' : ''}${tokens(usage.inputTokens)} in / ${tokens(usage.outputTokens)} out`;

  if (partial || usage.unpricedCalls > 0) return counts;

  return `${counts} · ~$${usage.estimatedCostUsd.toFixed(4)}`;
}
