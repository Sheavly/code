import type { Hook } from '@sheavly/core/hook/hook.types';
import { errorMessage } from '@sheavly/runtime/errors/errors.utils';

/** Which hook handler failed. */
type HookHandler = Exclude<keyof Hook, 'name'>;

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
 * A summarizer's result broke the rules for a checkpoint (empty, too large, not smaller than what
 * it replaces, or history that is no longer valid), so none was appended. `summarizer` names who
 * wrote it, so the failure points at the culprit.
 */
export class SummaryRejectedError extends Error {
  override name = 'SummaryRejectedError';
  readonly summarizer: string;
  readonly problem: string;

  constructor(params: { summarizer: string; problem: string; cause?: unknown }) {
    const { summarizer, problem, cause } = params;

    super(`Summarizer ${summarizer} produced a summary that was rejected: ${problem}`, { cause });
    this.summarizer = summarizer;
    this.problem = problem;
  }
}

/** The run's event stream ended without its `done` event, so the run's outcome is unknown. */
export class StreamEndedError extends Error {
  override name = 'StreamEndedError';

  constructor() {
    super('Agent stream ended without a done event');
  }
}
