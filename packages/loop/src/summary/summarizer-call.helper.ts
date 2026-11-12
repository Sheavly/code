import type { Summarizer, SummaryResult } from '@sheavly/core/summary/summary.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import type { SummaryBody } from '@sheavly/core/summary/summary.types';
import { raceAbort } from '../abort/abort.utils.js';
import { SummaryRejectedError } from '../errors/loop.errors.js';
import type { AgentEvents } from '../stream-agent/stream-agent.types.js';

/**
 * Throws a `SummaryRejectedError` naming `summarizer` when `signal` has aborted. `problem` says
 * what had not finished, so an abort before the summarizer ran is not blamed on it.
 */
export function assertNotAborted(params: {
  summarizer: string;
  signal: AbortSignal;
  problem?: string;
}): void {
  const { summarizer, signal, problem = 'the run was aborted before it finished' } = params;

  if (signal.aborted) throw new SummaryRejectedError({ summarizer, problem, kind: 'cancellation' });
}

/**
 * Has `summarizer` write the sections for `span`, and reports what the call cost as a `usage`
 * event tagged `summary`, even when the caller later rejects the result: it was paid for. The tag
 * keeps it out of the session's last tokens, which describe the conversation's context.
 * Throws a `SummaryRejectedError` when the run aborts or the summarizer returns nothing.
 */
export async function callSummarizer(params: {
  summarizer: Summarizer;
  span: { messages: readonly Message[]; previous: SummaryBody | undefined };
  signal: AbortSignal;
  events: AgentEvents;
}): Promise<SummaryResult> {
  const { summarizer, span, signal, events } = params;
  // Raced against the abort: a summarizer that ignores its signal must not hold the run.
  const body = await raceAbort({
    work: summarizer.summarize({ messages: span.messages, previous: span.previous, signal }),
    signal,
  });

  assertNotAborted({ summarizer: summarizer.name, signal });

  if (body === undefined) {
    throw new SummaryRejectedError({
      summarizer: summarizer.name,
      problem: 'it returned no result',
      kind: 'generation',
    });
  }

  if (body.usage) events.enqueue({ type: 'usage', usage: { ...body.usage, purpose: 'summary' } });

  return body;
}
