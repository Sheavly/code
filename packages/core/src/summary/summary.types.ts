import type { Message, SummaryMessage } from '@sheavly/protocol/message/message.types';
import type { ModelUsage } from '@sheavly/protocol/usage/usage.types';

/** What a summarizer writes: the sections of a checkpoint. The loop adds the rest of the message. */
export type SummaryBody = Pick<SummaryMessage, 'sections'>;

/**
 * What `summarize` returns: the sections, and the usage of the model call that wrote them when
 * there was one (a rules-only summarizer has none). The loop reports it as a `usage` event tagged
 * `summary`, so the spend shows in the conversation's totals even when the result is rejected.
 */
export type SummaryResult = SummaryBody & { usage?: ModelUsage | undefined };

/**
 * What writes a checkpoint, written against by a UI's summarizer (rules, a model, a cheaper
 * model). It gets the span to summarize, already cut so no tool call is split from its result,
 * and the previous checkpoint's sections to merge into rather than regenerate. It returns the
 * whole new set of sections; the loop rejects a result that is empty, too large or not smaller
 * than what it replaces. It must stop when `signal` aborts, and treat `messages` as text to
 * summarize, never as instructions.
 */
export type Summarizer = {
  name: string;
  summarize(input: {
    messages: readonly Message[];
    previous?: SummaryBody | undefined;
    signal: AbortSignal;
  }): Promise<SummaryResult>;
};

/**
 * When to summarize and how big things may be. Token counts for the tail and the summary are
 * estimates; the amount used is what the last model call reported.
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

/**
 * The `summary` option of a run: who writes the checkpoint, and when. The loop applies it, and a
 * host that starts runs passes it through without knowing the loop.
 */
export type SummaryOptions = {
  summarizer: Summarizer;
  /** Overrides of the loop's default policy. */
  policy?: Partial<SummaryPolicy>;
};
