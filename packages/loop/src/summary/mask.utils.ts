import type { Message } from '@sheavly/protocol/message/message.types';
import { hiddenToolResult } from './mask.prompt.js';
import {
  MASK_KEEP_RESULTS,
  MASK_MIN_CHARS,
  MASK_START_SHARE,
  MASK_STEP_RESULTS,
} from './summary.constants.js';
import { estimateTokens } from './summary.utils.js';

/** The line that says where a command's complete output is kept, if the result has one. */
function referenceLine(content: string): string | undefined {
  return /^Full output: output_ref=.*$/m.exec(content)?.[0];
}

/**
 * How many of the oldest tool results are hidden, among `count`: none until more than the newest
 * `MASK_KEEP_RESULTS`, then a whole number of steps, so the count grows in jumps.
 */
function hiddenCount(count: number): number {
  return Math.floor(Math.max(0, count - MASK_KEEP_RESULTS) / MASK_STEP_RESULTS) * MASK_STEP_RESULTS;
}

/**
 * `view` with its oldest large tool results replaced by a note, for one model call (stored history
 * and what a summarizer reads are untouched). Applies only once the view is estimated to fill
 * `MASK_START_SHARE` of the window, and decides from the view itself, never from a reported
 * usage, so what is hidden only grows until a summary: it cannot flip back and break the cached
 * prompt prefix. Calls stay paired with their results, the error flag stays, and a result's
 * `output_ref` line is kept. Returns `view` itself when nothing is hidden. Without a known
 * window nothing is hidden.
 */
export function maskOldToolOutput(params: {
  view: readonly Message[];
  window: number | undefined;
}): readonly Message[] {
  const { view, window } = params;

  if (window === undefined) return view;

  const tokens = view.reduce((sum, message) => sum + estimateTokens(message), 0);

  if (tokens < window * MASK_START_SHARE) return view;

  const hidden = hiddenCount(view.filter((message) => message.role === 'tool').length);

  if (hidden === 0) return view;

  let seen = 0;

  return view.map((message) => {
    if (message.role !== 'tool') return message;

    const ordinal = seen;

    seen += 1;

    if (ordinal >= hidden || message.content.length < MASK_MIN_CHARS) return message;

    return {
      ...message,
      content: hiddenToolResult({
        chars: message.content.length,
        reference: referenceLine(message.content),
      }),
    };
  });
}
