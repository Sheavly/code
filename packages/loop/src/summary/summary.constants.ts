import type { SummaryPolicy } from '@sheavly/core/summary/summary.types';

/**
 * Starting points, not measured values: trigger at 15% of the window free (at least 16k tokens),
 * a tail of about 15k tokens, three failures in a row. A UI overrides any of them through the
 * `summary` option. A model-backed summarizer is bounded by its model's output limit; a custom
 * one is held only to being smaller than what it replaces.
 */
export const DEFAULT_SUMMARY_POLICY: SummaryPolicy = {
  freeShare: 0.15,
  minFreeTokens: 16_000,
  keepTokens: 15_000,
  maxFailures: 3,
};

/** The token estimate for text with no tokenizer: one token per this many characters. */
export const CHARS_PER_TOKEN = 4;
