import type { Conversation } from '@sheavly/host/conversation/conversation.types';
import type { Harness } from '@sheavly/host/host/host.types';
import { until } from '@sheavly/testing/wait/until.fake';

/**
 * Resolves once the conversation has finished everything a prompt started: its background work
 * is over and the run the conversation starts itself to report it has ended. A prompt ends when
 * the model finishes, so a test that reads what a sub-agent did waits here.
 */
export async function untilSettled(params: {
  harness: Pick<Harness, 'tasks'>;
  conversation: Pick<Conversation, 'running'>;
}): Promise<void> {
  const { harness, conversation } = params;

  // A run the conversation starts for a finished task begins on the next tick.
  await new Promise((resolve) => setTimeout(resolve, 0));

  await until(
    () =>
      harness.tasks.runningCount === 0 && !harness.tasks.hasDeliveries() && !conversation.running,
  );
}
