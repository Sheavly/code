import type { DoneReason } from '@sheavly/protocol/event/event.types';
import type { TurnContext } from './stream-agent.types.js';

/** Preserve partial replies and completed tool results, then ask for the unfinished work only. */
export function continueAfterOutputLimit(context: TurnContext): DoneReason | undefined {
  const { options, turn, outputRecovery } = context;
  const maxAttempts = options.maxOutputContinuations;

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
