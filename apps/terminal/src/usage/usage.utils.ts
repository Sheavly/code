import type { ContextUsage, UsageTotals } from '@sheavly/protocol/usage/usage.types';
import { contextWindowLabel } from '@sheavly/protocol/model/model.utils';

function tokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;

  return `${(value / 1_000_000).toFixed(1)}m`;
}

function percentage(context: ContextUsage | undefined): string {
  if (context?.window === undefined || context.used === undefined) return '';

  return ` (${String(Math.round((context.used / context.window) * 100))}%)`;
}

/** Last-call context measurement alongside cumulative cost. Neither unknown value appears as zero. */
export function usageText(params: {
  context: ContextUsage | undefined;
  usage: UsageTotals | undefined;
}): string {
  const { context, usage } = params;
  const used = context?.used === undefined ? '?' : tokens(context.used);
  const window = context?.window;
  const capacity = window === undefined ? '' : ` / ${contextWindowLabel(window)}`;
  const measured = `context ${used}${capacity}${percentage(context)}`;

  if (!usage || usage.calls === 0 || usage.incomplete || usage.missingUsageCalls > 0) {
    return measured;
  }

  if (usage.unpricedCalls > 0) return measured;

  return `${measured} · ~$${usage.estimatedCostUsd.toFixed(4)}`;
}
