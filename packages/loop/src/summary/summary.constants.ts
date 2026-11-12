import type { SummaryPolicy } from '@sheavly/core/summary/summary.types';

/**
 * Starting points, not measured values: trigger when 85% of the window is used (15% free, with no
 * extra floor), a fixed tail of about 15k tokens only where the window is unknown (a known window
 * sizes the tail from `TARGET_*`), three failures in a row. A UI overrides any of them through the
 * `summary` option. A model-backed summarizer is bounded by its model's output limit; a custom
 * one is held only to being smaller than what it replaces.
 */
export const DEFAULT_SUMMARY_POLICY: SummaryPolicy = {
  freeShare: 0.15,
  minFreeTokens: 0,
  keepTokens: 15_000,
  maxFailures: 3,
};

/** Share of the window the context should use right after a summary: never below this... */
export const TARGET_MIN_SHARE = 0.15;

/** ...and never above this, however full the context was. */
export const TARGET_MAX_SHARE = 0.5;

/** Within those bounds, the context aims for this share of what it was using when it summarized. */
export const TARGET_RATIO = 0.35;

/** Share of the window left for the checkpoint and the entries pinned in front of the tail. */
export const CHECKPOINT_RESERVE_SHARE = 0.1;

/**
 * Old tool results are hidden from what a model is sent once the unmasked view is estimated to fill
 * this share of the window (hiding old output is cheaper than a summary and loses no decision)...
 */
export const MASK_START_SHARE = 0.4;

/** ...the newest this many tool results always stay whole... */
export const MASK_KEEP_RESULTS = 10;

/**
 * ...and older ones are hidden this many at a time, so what a model is sent changes only every few
 * results and its cached prompt prefix survives the turns in between.
 */
export const MASK_STEP_RESULTS = 8;

/** A result shorter than this is not worth hiding: the note about it would be as long. */
export const MASK_MIN_CHARS = 400;

/** The token estimate for text with no tokenizer: one token per this many characters. */
export const CHARS_PER_TOKEN = 4;
