import type { Hook } from '@sheavly/core/hook/hook.types';
import { errorMessage } from '@sheavly/runtime/errors/errors.utils';
import type { AgentEventBody } from '@sheavly/protocol/event/event.types';

type SummaryFailureKind = NonNullable<Extract<AgentEventBody, { type: 'summary_failed' }>['kind']>;

/** Which hook handler failed, or `contribution` for a turn contribution that was skipped. */
type HookHandler = Exclude<keyof Hook, 'name'> | 'contribution';

/**
 * A hook's handler threw where its failure must not stop the run (`onError`): the run's own error
 * is still the one thrown, and this is reported to the host as a `hook_failed` event.
 */
export class HookError extends Error {
  override name = 'HookError';
  readonly hook: string;
  readonly handler: HookHandler;

  constructor(params: { hook: string; handler: HookHandler; cause: unknown }) {
    const { hook, handler, cause } = params;

    super(`Hook ${hook} failed in ${handler}: ${errorMessage(cause)}`, { cause });
    this.hook = hook;
    this.handler = handler;
  }
}

/** A hook handler that must not hold the run took longer than it was given. */
export class HookTimeoutError extends Error {
  override name = 'HookTimeoutError';
  readonly timeoutMs: number;

  constructor(params: { timeoutMs: number }) {
    super(`did not finish within ${params.timeoutMs}ms`);
    this.timeoutMs = params.timeoutMs;
  }
}

/**
 * The messages a model call was about to send break the history rules (a tool call without its
 * result or the reverse, or the latest user message changed). `source` names what produced them,
 * e.g. `Hook trim`, so the run fails with the culprit rather than a provider error.
 */
export class InvalidHistoryError extends Error {
  override name = 'InvalidHistoryError';
  readonly source: string;
  readonly problem: string;

  constructor(params: { source: string; problem: string; cause?: unknown }) {
    const { source, problem, cause } = params;

    super(`${source} produced invalid history: ${problem}`, { cause });
    this.source = source;
    this.problem = problem;
  }
}

/**
 * A summarizer's result broke the rules for a checkpoint (empty, not smaller than what
 * it replaces, or history that is no longer valid), so none was appended. `summarizer` names who
 * wrote it, so the failure points at the culprit.
 */
export class SummaryRejectedError extends Error {
  override name = 'SummaryRejectedError';
  readonly summarizer: string;
  readonly problem: string;
  /** Which kind of failure it is, as `summary_failed` reports it. */
  readonly kind: SummaryFailureKind;

  constructor(params: {
    summarizer: string;
    problem: string;
    kind: SummaryFailureKind;
    cause?: unknown;
  }) {
    const { summarizer, problem, kind, cause } = params;

    super(`Summarizer ${summarizer} produced a summary that was rejected: ${problem}`, { cause });
    this.summarizer = summarizer;
    this.problem = problem;
    this.kind = kind;
  }
}

/**
 * What a `beforeSummary` hook returned is not a valid change (a typo'd key, a wrong type, a
 * section without an id). The summary fails with this, naming the hook; the run goes on.
 */
export class SummaryHookError extends Error {
  override name = 'SummaryHookError';
  readonly hook: string;
  readonly problem: string;

  constructor(params: { hook: string; problem: string; cause?: unknown }) {
    const { hook, problem, cause } = params;

    super(`Hook ${hook} returned an invalid summary change: ${problem}`, { cause });
    this.hook = hook;
    this.problem = problem;
  }
}

/**
 * A phase's contributions are miswired: a name used twice, an `after` naming one that is not
 * registered, or a cycle. Thrown when the run starts, so it never surfaces halfway through a turn.
 */
export class ContributionError extends Error {
  override name = 'ContributionError';
  readonly problem: 'duplicate' | 'unknown_after' | 'cycle';

  constructor(params: { problem: 'duplicate' | 'unknown_after' | 'cycle'; message: string }) {
    super(params.message);
    this.problem = params.problem;
  }
}

/** The run's event stream ended without its `done` event, so the run's outcome is unknown. */
export class StreamEndedError extends Error {
  override name = 'StreamEndedError';

  constructor() {
    super('Agent stream ended without a done event');
  }
}
