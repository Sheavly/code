import type { DoneReason } from '@sheavly/protocol/event/event.types';
import { MAX_FRUITLESS_CONTINUATIONS } from './stream-agent.constants.js';
import type { TurnContext } from './stream-agent.types.js';

/**
 * Preserve partial replies and completed tool results, then ask for the unfinished work only.
 * `progressed` is whether the truncated reply kept any text or tool call; consecutive replies that
 * kept none end the run, since asking again repeats the same cut-off.
 */
export function continueAfterOutputLimit(params: {
  context: TurnContext;
  progressed: boolean;
}): DoneReason | undefined {
  const { context, progressed } = params;
  const { options, turn, outputRecovery } = context;
  const maxAttempts = options.maxOutputContinuations;

  outputRecovery.fruitless = progressed ? 0 : outputRecovery.fruitless + 1;

  if (outputRecovery.fruitless >= MAX_FRUITLESS_CONTINUATIONS) return 'max_tokens';
  if (maxAttempts !== undefined && outputRecovery.attempts >= maxAttempts) return 'max_tokens';
  if (turn >= (options.maxTurns ?? Infinity)) return 'max_turns';

  outputRecovery.attempts++;
  outputRecovery.pending = {
    kind: 'output-continuation',
    attempt: outputRecovery.attempts,
    ...(maxAttempts !== undefined && { maxAttempts }),
  };

  return undefined;
}
