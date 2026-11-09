import type { Message, SummaryMessage } from '@sheavly/protocol/message/message.types';

/** What a summarizer writes: the sections of a checkpoint. The loop adds the rest of the message. */
export type SummaryBody = Pick<SummaryMessage, 'sections'>;

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
  }): Promise<SummaryBody>;
};
