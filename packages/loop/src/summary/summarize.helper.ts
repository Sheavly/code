import { now } from '@sheavly/core/clock/clock.helper';
import { redactDiagnosticText } from '@sheavly/runtime/errors/diagnostic-text.utils';
import { errorMessage } from '@sheavly/runtime/errors/errors.utils';
import type { AgentEventBody } from '@sheavly/protocol/event/event.types';
import type { SummaryMessage } from '@sheavly/protocol/message/message.types';
import type { TurnContext } from '../stream-agent/stream-agent.types.js';
import { buildCheckpoint } from './checkpoint.utils.js';
import { DEFAULT_SUMMARY_POLICY } from './summary.constants.js';
import { whenAborted } from '../abort/abort.utils.js';
import { contextState } from '../context/context.utils.js';
import { SummaryRejectedError } from '../errors/loop.errors.js';
import {
  chooseCut,
  estimateTokens,
  shouldSummarize,
  spanToSummarize,
  viewOf,
} from './summary.utils.js';

type SummaryReason = Extract<AgentEventBody, { type: 'summary_started' }>['reason'];

/** What a model would be sent, in estimated tokens: the number a summary is judged against. */
function viewTokens(context: TurnContext): number {
  return viewOf(context.messages).reduce((sum, message) => sum + estimateTokens(message), 0);
}

function doneEvent(params: {
  checkpoint: SummaryMessage;
  tokensBefore: number;
  messagesBefore: number;
  context: TurnContext;
}): AgentEventBody {
  const { checkpoint, tokensBefore, messagesBefore, context } = params;

  return {
    type: 'summary_done',
    tokensBefore,
    tokensAfter: viewTokens(context),
    messagesBefore,
    messagesAfter: viewOf(context.messages).length,
    summarized: checkpoint.summarized,
    kept: checkpoint.kept,
    summarizer: checkpoint.summarizer,
    sections: checkpoint.sections.map(({ id, title, body }) => ({ id, title, chars: body.length })),
  };
}

/**
 * Summarizes when the context nears the window, before the turn's hooks and model call. Does
 * nothing without the `summary` option, once threshold summaries have failed `maxFailures` times
 * in a row this run, or while the last call's usage is unknown. The caller reads the context
 * state again afterwards: a checkpoint clears the session's last reported tokens.
 */
export async function summarizeAtThreshold(context: TurnContext): Promise<void> {
  const { options, session, summaryFailures } = context;
  const config = options.summary;

  if (!config) return;

  const policy = { ...DEFAULT_SUMMARY_POLICY, ...config.policy };

  if (summaryFailures.count >= policy.maxFailures) return;

  const state = contextState({
    window: options.provider.contextWindow,
    lastTokens: session.registry.lastTokens(session.ref.id),
  });

  if (!shouldSummarize({ context: state, policy })) return;

  await summarizeHistory({ context, reason: 'threshold', used: state.used });
}

/**
 * Writes one checkpoint for the run's history, when the `summary` option is set and there is
 * something older than the tail to summarize. Emits `summary_started` and then exactly one
 * `summary_done` or `summary_failed`, so a spinner never hangs. Returns whether a checkpoint was
 * appended. A failed summary never fails the run: it is reported as an event and the history is
 * left as it was; threshold failures are counted so the run stops trying after `maxFailures` in
 * a row, while an overflow is tried once per model call by the caller.
 */
export async function summarizeHistory(params: {
  context: TurnContext;
  reason: SummaryReason;
  /** What the last model call reported, when known; otherwise the view is estimated. */
  used?: number | undefined;
}): Promise<boolean> {
  const { context, reason, used } = params;
  const { options, session, signal, events, messages, summaryFailures } = context;
  const config = options.summary;

  if (!config) return false;

  const policy = { ...DEFAULT_SUMMARY_POLICY, ...config.policy };
  const cut = chooseCut({ history: messages, keepTokens: policy.keepTokens });

  if (cut === undefined) return false;

  const tokensBefore = used ?? viewTokens(context);
  const messagesBefore = viewOf(messages).length;

  events.enqueue({ type: 'summary_started', reason, tokensBefore, messagesBefore });

  try {
    const span = spanToSummarize({ history: messages, cut });
    // Raced against the abort: a summarizer that ignores its signal must not hold the run. Its
    // late rejection is handled by the race itself, so it cannot go unhandled.
    const body = await Promise.race([
      config.summarizer.summarize({ messages: span.messages, previous: span.previous, signal }),
      whenAborted(signal).then(() => undefined),
    ]);

    if (signal.aborted) {
      throw new SummaryRejectedError({
        summarizer: config.summarizer.name,
        problem: 'the run was aborted before it finished',
      });
    }

    if (body === undefined) {
      throw new SummaryRejectedError({
        summarizer: config.summarizer.name,
        problem: 'it returned no result',
      });
    }

    const checkpoint = buildCheckpoint({
      summarizer: config.summarizer.name,
      body,
      history: messages,
      cut,
      policy,
      at: now(),
    });

    messages.push(checkpoint);
    // The last call's numbers described the history that was just replaced.
    session.registry.forgetLastTokens(session.ref.id);
    summaryFailures.count = 0;
    events.enqueue(doneEvent({ checkpoint, tokensBefore, messagesBefore, context }));

    return true;
  } catch (caughtError) {
    // A summary is an optimisation: whatever went wrong (the summarizer, the checks, an abort) is
    // reported on the stream and the run carries on with the unchanged view.
    if (reason === 'threshold' && !signal.aborted) summaryFailures.count += 1;

    events.enqueue({
      type: 'summary_failed',
      reason,
      error: redactDiagnosticText(errorMessage(caughtError)),
      retriesLeft: Math.max(0, policy.maxFailures - summaryFailures.count),
    });

    return false;
  }
}
