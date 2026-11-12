import type { SummaryBody } from '@sheavly/core/summary/summary.types';
import { summaryMessageSchema } from '@sheavly/protocol/message/message.validator';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { Message, SummaryMessage } from '@sheavly/protocol/message/message.types';
import { InvalidHistoryError, SummaryRejectedError } from '../errors/loop.errors.js';
import { assertValidHistory } from '../history/history.utils.js';
import {
  estimateTokens,
  latestCheckpoint,
  pinnedBefore,
  spanToSummarize,
  viewOf,
} from './summary.utils.js';

/**
 * Turns a summarizer's sections into the checkpoint to append, or throws a `SummaryRejectedError`
 * naming it. A checkpoint is rejected when it is not valid, has no sections, is not smaller than
 * the messages it replaces, or would leave a model a history that breaks the rules
 * (`assertValidHistory` on the view it would produce). Nothing is appended here: the caller does
 * that only with the result.
 */
export function buildCheckpoint(params: {
  summarizer: string;
  body: SummaryBody;
  history: readonly HistoryMessage[];
  cut: number;
  /** When the checkpoint is written, epoch milliseconds (read by the caller with `now()`). */
  at: number;
}): SummaryMessage {
  const { summarizer, body, history, cut, at } = params;
  const span = spanToSummarize({ history, cut });
  // A pinned user message is still shown word for word, so the checkpoint does not replace it.
  const pinned = pinnedBefore({ history, start: cut });
  const replacedMessages = span.messages.filter((message) => !pinned.includes(message));
  const parsed = summaryMessageSchema.safeParse({
    role: 'summary',
    sections: body.sections,
    kept: history.length - cut,
    summarized: replacedMessages.length,
    summarizer,
    at,
  });

  if (!parsed.success) {
    throw new SummaryRejectedError({
      summarizer,
      problem: 'its result is not a valid checkpoint',
      cause: parsed.error,
    });
  }

  const checkpoint = parsed.data;
  const replaced = replacedMessages.reduce((sum, message) => sum + estimateTokens(message), 0);
  const problem = findSizeProblem({ checkpoint, replaced });

  if (problem) throw new SummaryRejectedError({ summarizer, problem });

  assertValidHistory({
    messages: viewOf([...history, checkpoint]),
    latestRequest: history.findLast((message): message is Message => message.role === 'user'),
    source: `Summarizer ${summarizer}`,
  });

  return checkpoint;
}

/**
 * Throws an `InvalidHistoryError` when a history that already holds a checkpoint would show a
 * model something invalid: a `kept` that makes the view start on a tool result (a hand-edited or
 * damaged file). The latest user message is always in the view, pinned or in the tail. Nothing
 * to check without a checkpoint.
 * A history the engine wrote passes, since `buildCheckpoint` checked the same view.
 */
export function assertValidStoredHistory(history: readonly HistoryMessage[]): void {
  const latest = latestCheckpoint(history);

  if (!latest) return;

  // `viewOf` clamps a `kept` that reaches past the start of history, which would show again what
  // the checkpoint replaced, so a checkpoint that claims more than exists is refused outright.
  if (latest.checkpoint.kept > latest.index) {
    throw new InvalidHistoryError({
      source: 'Stored history',
      problem: `a checkpoint keeps ${latest.checkpoint.kept} messages but only ${latest.index} come before it`,
    });
  }

  assertValidHistory({
    messages: viewOf(history),
    latestRequest: history.findLast((message): message is Message => message.role === 'user'),
    source: 'Stored history',
  });
}

function findSizeProblem(params: {
  checkpoint: SummaryMessage;
  replaced: number;
}): string | undefined {
  const { checkpoint, replaced } = params;

  if (checkpoint.sections.length === 0) return 'it has no sections';

  // What a model is sent in place of the span, framing included, must still be smaller.
  const shown = estimateTokens(checkpoint);

  if (shown >= replaced) {
    return `it is about ${shown} tokens, not smaller than the ${replaced} it replaces`;
  }

  return undefined;
}
