import type { SummaryBody } from '@sheavly/core/summary/summary.types';
import { summaryMessageSchema } from '@sheavly/protocol/message/message.validator';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { latestRequest } from '@sheavly/core/history/history.utils';
import type { SummaryMessage } from '@sheavly/protocol/message/message.types';
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
    covered: cut,
    ...previousCheckpoint(history),
    summarizer,
    at,
  });

  if (!parsed.success) {
    throw new SummaryRejectedError({
      summarizer,
      problem: 'its result is not a valid checkpoint',
      kind: 'generation',
      cause: parsed.error,
    });
  }

  const checkpoint = parsed.data;
  const replaced = replacedMessages.reduce((sum, message) => sum + estimateTokens(message), 0);
  const problem = findSizeProblem({ checkpoint, replaced });

  if (problem) throw new SummaryRejectedError({ summarizer, ...problem });

  assertSummaryPreserves({ summarizer, history, checkpoint });

  return checkpoint;
}

/** The `incorporated` field for a checkpoint about to follow `history`: its newest checkpoint. */
function previousCheckpoint(history: readonly HistoryMessage[]): { incorporated?: number } {
  const previous = latestCheckpoint(history);

  return previous ? { incorporated: previous.index } : {};
}

/**
 * Throws an `InvalidHistoryError` when the coverage a checkpoint records contradicts the history:
 * it must end where its own tail begins, fold in exactly the checkpoint before it, and never
 * cover less than that one did, so nothing is skipped or taken twice. Legacy checkpoints that
 * record none are not held to it.
 */
function assertCoverageConsistent(history: readonly HistoryMessage[]): void {
  let previous: { index: number; covered: number | undefined } | undefined;

  history.forEach((entry, index) => {
    if (entry.role !== 'summary') return;

    const problem = coverageProblem({ entry, index, previous });

    if (problem) throw new InvalidHistoryError({ source: 'Stored history', problem });

    previous = { index, covered: entry.covered };
  });
}

function coverageProblem(params: {
  entry: SummaryMessage;
  index: number;
  previous: { index: number; covered: number | undefined } | undefined;
}): string | undefined {
  const { entry, index, previous } = params;

  if (entry.covered === undefined) return undefined;

  if (entry.covered !== index - entry.kept) {
    return `a checkpoint covers ${entry.covered} entries but its tail begins at ${index - entry.kept}`;
  }

  if (entry.incorporated !== previous?.index) {
    return 'a checkpoint does not fold in the checkpoint before it, so a summary was skipped or taken twice';
  }

  if (previous?.covered !== undefined && entry.covered < previous.covered) {
    return 'a checkpoint covers less than the one it folds in';
  }

  return undefined;
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

  assertCoverageConsistent(history);

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
    latestRequest: latestRequest(history),
    source: 'Stored history',
  });
}

/**
 * The history rules the new checkpoint's view must still meet. A violation is a failure to
 * preserve (the request, tool pairing), reported as such rather than as a generic rejection.
 */
function assertSummaryPreserves(params: {
  summarizer: string;
  history: readonly HistoryMessage[];
  checkpoint: SummaryMessage;
}): void {
  const { summarizer, history, checkpoint } = params;

  try {
    assertValidHistory({
      messages: viewOf([...history, checkpoint]),
      latestRequest: latestRequest(history),
      source: `Summarizer ${summarizer}`,
    });
  } catch (caughtError) {
    // Only the history rules are this function's to translate; anything else is not.
    if (!(caughtError instanceof InvalidHistoryError)) throw caughtError;

    throw new SummaryRejectedError({
      summarizer,
      problem: caughtError.problem,
      kind: 'preservation',
      cause: caughtError,
    });
  }
}

function findSizeProblem(params: {
  checkpoint: SummaryMessage;
  replaced: number;
}): { problem: string; kind: 'generation' | 'size' } | undefined {
  const { checkpoint, replaced } = params;

  if (checkpoint.sections.length === 0) {
    return { problem: 'it has no sections', kind: 'generation' };
  }

  // What a model is sent in place of the span, framing included, must still be smaller.
  const shown = estimateTokens(checkpoint);

  if (shown >= replaced) {
    return {
      problem: `it is about ${shown} tokens, not smaller than the ${replaced} it replaces`,
      kind: 'size',
    };
  }

  return undefined;
}
