import type { Summarizer } from '@sheavly/core/summary/summary.types';

/**
 * When to summarize and how big things may be. Token counts for the tail and the summary are
 * estimates (`estimateTokens`); the amount used is what the last model call reported.
 */
export type SummaryPolicy = {
  /** Summarize when less than this share of the window is free... */
  freeShare: number;
  /** ...or less than this many tokens, whichever is more (never more than half the window). */
  minFreeTokens: number;
  /** About how many tokens of the newest messages stay word for word. */
  keepTokens: number;
  /** The most tokens a summary may take; a longer one is rejected. */
  maxSummaryTokens: number;
  /** Failed threshold summaries in a row before the run stops trying. */
  maxFailures: number;
};

/** The `summary` option of the loop: who writes the checkpoint, and when. */
export type SummaryOptions = {
  summarizer: Summarizer;
  /** Overrides of `DEFAULT_SUMMARY_POLICY`. */
  policy?: Partial<SummaryPolicy>;
};
