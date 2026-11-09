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
