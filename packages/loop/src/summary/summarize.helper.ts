import { now } from '@sheavly/core/clock/clock.helper';
import { redactDiagnosticText } from '@sheavly/runtime/errors/diagnostic-text.utils';
import { errorMessage } from '@sheavly/runtime/errors/errors.utils';
import type { SummaryReason } from '@sheavly/core/hook/hook.types';
import type { SummaryOptions } from '@sheavly/core/summary/summary.types';
import type { AgentEventBody } from '@sheavly/protocol/event/event.types';
import type { SummaryMessage } from '@sheavly/protocol/message/message.types';
import type { TurnContext } from '../stream-agent/stream-agent.types.js';
import { SummaryRejectedError } from '../errors/loop.errors.js';
import { buildCheckpoint } from './checkpoint.utils.js';
import { DEFAULT_SUMMARY_POLICY } from './summary.constants.js';
import { assertNotAborted, callSummarizer } from './summarizer-call.helper.js';
import { contextState } from '../context/context.utils.js';
import { runAfterSummary, runBeforeSummary } from '../hooks/hooks.helper.js';
import {
  chooseCut,
  estimateTokens,
  keepTokensFor,
  maxTailTokensFor,
  mergeSections,
  shouldSummarize,
  spanToSummarize,
  viewOf,
} from './summary.utils.js';

type SummaryFailureKind = NonNullable<Extract<AgentEventBody, { type: 'summary_failed' }>['kind']>;

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
 *
 * Returns `'full'` when the context is past the threshold, no summary could shrink it (one
 * failed, was not tried again, or left nothing to summarize) and what a model would be sent is
 * estimated to fill the whole window: carrying on would only end in a provider error, so the
 * caller stops with a recoverable `context_window_exceeded`. Otherwise `'ok'`, and the run goes
 * on with the view unchanged.
 */
export async function summarizeAtThreshold(context: TurnContext): Promise<'ok' | 'full'> {
  const { options, session, summaryFailures } = context;
  const config = options.summary;

  if (!config) return 'ok';

  const policy = { ...DEFAULT_SUMMARY_POLICY, ...config.policy };
  const state = contextState({
    window: options.provider.contextWindow,
    lastTokens: session.registry.lastTokens(session.ref.id),
  });

  if (!shouldSummarize({ context: state, policy })) return 'ok';

  const gaveUp = summaryFailures.count >= policy.maxFailures;
  const summarized =
    !gaveUp && (await summarizeHistory({ context, reason: 'threshold', used: state.used }));

  if (summarized) return 'ok';

  const { window } = state;

  return window !== undefined && viewTokens(context) >= window ? 'full' : 'ok';
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
  // A tail the UI chose is kept as chosen; otherwise it follows the window and how full it was.
  const keepTokens =
    config.policy?.keepTokens ??
    keepTokensFor({
      window: options.provider.contextWindow,
      used,
      fallback: policy.keepTokens,
    });
  const cut = chooseCut({
    history: messages,
    keepTokens,
    // A tail the UI chose is kept as chosen, so only a computed one is capped.
    maxTailTokens:
      config.policy?.keepTokens === undefined
        ? maxTailTokensFor(options.provider.contextWindow)
        : undefined,
  });

  if (cut === undefined) return false;

  const tokensBefore = used ?? viewTokens(context);
  const messagesBefore = viewOf(messages).length;

  events.enqueue({ type: 'summary_started', reason, tokensBefore, messagesBefore });

  let checkpoint: SummaryMessage;

  try {
    checkpoint = await writeCheckpointWithRetry({ context, reason, config, cut });
  } catch (caughtError) {
    // A summary is an optimisation: whatever went wrong (a `beforeSummary` hook, the summarizer,
    // the checks, an abort) is reported on the stream and the run carries on with the unchanged
    // view.
    if (reason === 'threshold' && !signal.aborted) summaryFailures.count += 1;

    events.enqueue({
      type: 'summary_failed',
      reason,
      kind: failureKindOf({ error: caughtError, aborted: signal.aborted }),
      error: redactDiagnosticText(errorMessage(caughtError)),
      retriesLeft: Math.max(0, policy.maxFailures - summaryFailures.count),
    });

    return false;
  }

  messages.push(checkpoint);
  // The last call's numbers described the history that was just replaced.
  session.registry.forgetLastTokens(session.ref.id);
  summaryFailures.count = 0;
  events.enqueue(doneEvent({ checkpoint, tokensBefore, messagesBefore, context }));

  // Outside the try: the summary is done and reported, and an `afterSummary` hook that throws
  // fails the run like any other hook, so it cannot be mistaken for a failed summary.
  await runAfterSummary({
    hooks: options.hooks ?? [],
    reason,
    checkpoint,
    messages,
    signal,
    onContext: (added) => events.enqueue({ type: 'context_added', ...added }),
  });

  return true;
}

/** How a failed summary is classified on the stream: an abort wins, then the error's own kind. */
function failureKindOf(params: { error: unknown; aborted: boolean }): SummaryFailureKind {
  if (params.aborted) return 'cancellation';

  return params.error instanceof SummaryRejectedError ? params.error.kind : 'generation';
}

/**
 * One initial attempt plus one retry, never more: a second try often succeeds where a model
 * wrote something unusable, but the same failed snapshot must not be retried turn after turn.
 * A cancelled run is not retried. Throws the retry's error when both fail.
 */
async function writeCheckpointWithRetry(
  params: Parameters<typeof writeCheckpoint>[0],
): Promise<SummaryMessage> {
  try {
    return await writeCheckpoint(params);
  } catch (caughtError) {
    if (params.context.signal.aborted) throw caughtError;

    return writeCheckpoint(params);
  }
}

/**
 * Asks the `beforeSummary` hooks, has the summarizer write the sections, and returns the checked
 * checkpoint without appending it. The hooks may move the cut (`keepTokens`, falling back to
 * `cut` when nothing older would be left to summarize) and add sections to what was written.
 * Throws on a bad hook result, a summarizer that fails or returns nothing, an abort, or a
 * checkpoint `buildCheckpoint` rejects.
 */
async function writeCheckpoint(params: {
  context: TurnContext;
  reason: SummaryReason;
  config: SummaryOptions;
  cut: number;
}): Promise<SummaryMessage> {
  const { context, reason, config } = params;
  const { options, session, signal, events, messages } = context;
  const change = await runBeforeSummary({
    hooks: options.hooks ?? [],
    reason,
    messages: viewOf(messages),
    context: contextState({
      window: options.provider.contextWindow,
      lastTokens: session.registry.lastTokens(session.ref.id),
    }),
    signal,
  });

  // A hook that ignores its signal is raced against the abort (`runBeforeSummary`), which leaves
  // here with the run aborted rather than hung.
  assertNotAborted({
    summarizer: config.summarizer.name,
    signal,
    problem: 'the run was aborted before the summarizer ran',
  });

  const cut =
    change.keepTokens === undefined
      ? params.cut
      : (chooseCut({ history: messages, keepTokens: change.keepTokens }) ?? params.cut);
  const body = await callSummarizer({
    summarizer: config.summarizer,
    span: spanToSummarize({ history: messages, cut }),
    signal,
    events,
  });

  const checkpoint = buildCheckpoint({
    summarizer: config.summarizer.name,
    body: { sections: mergeSections({ written: body.sections, added: change.sections }) },
    history: messages,
    cut,
    at: now(),
  });

  assertViewShrinks({ context, checkpoint, summarizer: config.summarizer.name });

  return checkpoint;
}

/**
 * A checkpoint is smaller than the span it replaces, but the tail it keeps counts too: one that
 * leaves the whole view bigger than before has made room for nothing, so it is rejected as a size
 * failure rather than reported as done.
 */
function assertViewShrinks(params: {
  context: TurnContext;
  checkpoint: SummaryMessage;
  summarizer: string;
}): void {
  const { context, checkpoint, summarizer } = params;
  const before = viewTokens(context);
  const after = viewOf([...context.messages, checkpoint]).reduce(
    (sum, message) => sum + estimateTokens(message),
    0,
  );

  if (after < before) return;

  throw new SummaryRejectedError({
    summarizer,
    problem: `the view would be about ${after} tokens, not smaller than the ${before} it is now`,
    kind: 'size',
  });
}
