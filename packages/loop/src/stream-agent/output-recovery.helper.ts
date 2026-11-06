import { now } from '@sheavly/core/clock/clock.helper';
import type { DoneReason } from '@sheavly/protocol/event/event.types';
import type { TurnContext } from './stream-agent.types.js';
import { OUTPUT_CONTINUATION_INSTRUCTION } from './stream-agent.constants.js';

/** Preserve partial replies and completed tool results, then ask for the unfinished work only. */
export function continueAfterOutputLimit(context: TurnContext): DoneReason | undefined {
  const { options, turn, outputRecovery, messages, events } = context;
  const maxAttempts = options.maxOutputContinuations ?? 2;

  if (outputRecovery.attempts >= maxAttempts) return 'max_tokens';
  if (turn >= (options.maxTurns ?? Infinity)) return 'max_turns';

  outputRecovery.attempts++;
  // A history message leaves the system prefix intact, so signed thinking remains replayable.
  messages.push({ role: 'user', content: OUTPUT_CONTINUATION_INSTRUCTION, at: now() });
  events.enqueue({
    type: 'output_continuation',
    attempt: outputRecovery.attempts,
    maxAttempts,
  });

  return undefined;
}
