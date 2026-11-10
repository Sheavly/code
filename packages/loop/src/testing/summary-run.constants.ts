import type { StreamEvent } from '@sheavly/core/message/message.types';

/** The context window the summary tests' provider reports. */
export const WINDOW = 100_000;

/** A model turn that answers and ends the run. */
export const answer: StreamEvent[] = [
  { type: 'text_delta', text: 'done' },
  { type: 'done', stopReason: 'end_turn' },
];

/** A model turn the provider rejects as too long. */
export const overflow: StreamEvent[] = [{ type: 'done', stopReason: 'context_window_exceeded' }];
