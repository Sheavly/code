import { summarizeHistory } from '../summary/summarize.helper.js';
import { maskOldToolOutput } from '../summary/mask.utils.js';
import { continueAfterOutputLimit } from './output-recovery.helper.js';
import { orderContributions } from './contributions.helper.js';
import type { TurnContributions } from './contributions.types.js';
import type { AgentOptions } from './stream-agent.types.js';

/**
 * The turn's features for one run, ordered and checked once at its start. Which features exist is
 * decided here, from the options, and nowhere else: a feature absent from a list is absent from
 * the turn, so `runTurn` never tests an option to know. Masking and overflow recovery exist only
 * with a `summary` option, since both trade on a checkpoint being possible.
 */
export function buildContributions(options: AgentOptions): TurnContributions {
  return {
    view: orderContributions(
      options.summary
        ? [
            {
              name: 'mask-old-tool-output',
              onFailure: 'fail-run' as const,
              abort: 'wait' as const,
              run: maskOldToolOutput,
            },
          ]
        : [],
    ),
    overflow: orderContributions(
      options.summary
        ? [
            {
              name: 'summarize-on-overflow',
              onFailure: 'fail-run' as const,
              abort: 'wait' as const,
              run: summarizeOnOverflow,
            },
          ]
        : [],
    ),
    limit: orderContributions([
      {
        name: 'window-exceeded',
        onFailure: 'fail-run' as const,
        abort: 'wait' as const,
        run: ({ stopReason }) =>
          stopReason === 'context_window_exceeded'
            ? { ended: 'context_window_exceeded' as const }
            : undefined,
      },
      {
        name: 'output-limit',
        after: ['window-exceeded'],
        onFailure: 'fail-run' as const,
        abort: 'wait' as const,
        run: ({ context, stopReason, running, reply }) => {
          if (stopReason !== 'max_tokens') {
            context.outputRecovery.fruitless = 0;

            return undefined;
          }

          // Reasoning alone is not progress: a provider drops unfinished thinking, so only text or
          // a tool call proves the next attempt can get further than this one.
          const progressed =
            reply.role === 'assistant' && (reply.content !== '' || running.length > 0);

          return { ended: continueAfterOutputLimit({ context, progressed }) };
        },
      },
    ]),
  };
}

/**
 * A call the provider rejected as too long gets one summary and a retry, once per model call (a
 * call that ends any other way re-arms it), so it cannot loop. True when a checkpoint was
 * appended: the turn drops the rejected reply and the next turn calls the model again.
 */
async function summarizeOnOverflow(params: {
  context: Parameters<typeof summarizeHistory>[0]['context'];
  stopReason: string;
  started: boolean;
}): Promise<boolean> {
  const { context, stopReason, started } = params;
  const { summaryFailures } = context;

  if (stopReason !== 'context_window_exceeded') {
    summaryFailures.overflowTried = false;

    return false;
  }

  if (started || summaryFailures.overflowTried) return false;

  summaryFailures.overflowTried = true;

  return summarizeHistory({ context, reason: 'overflow' });
}
