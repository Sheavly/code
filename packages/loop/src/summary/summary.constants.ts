import type { SummaryPolicy } from '@sheavly/core/summary/summary.types';

/**
 * Starting points, not measured values: trigger at 15% of the window free (at least 16k tokens),
 * a tail of about 15k tokens, a summary of at most 4k, three failures in a row. A UI overrides
 * any of them through the `summary` option.
 */
export const DEFAULT_SUMMARY_POLICY: SummaryPolicy = {
  freeShare: 0.15,
  minFreeTokens: 16_000,
  keepTokens: 15_000,
  maxSummaryTokens: 4_000,
  maxFailures: 3,
};

/** The token estimate for text with no tokenizer: one token per this many characters. */
export const CHARS_PER_TOKEN = 4;
