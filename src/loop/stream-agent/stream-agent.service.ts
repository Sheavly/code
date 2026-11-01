import type { Message } from '@sheavly/core/message/message.types';
import { whenAborted } from '../abort/abort.utils.js';
import type { AgentEvent, AgentEventBody, DoneReason } from '../events/events.types.js';
import { OrderedQueue } from '../queue/queue.service.js';
import { DEFAULT_MAX_TURNS } from './stream-agent.constants.js';
import { runOnError, runSessionStart } from '../hooks/hooks.service.js';
import type { AgentOptions, RunAgentOptions, RunContext } from './stream-agent.types.js';
import { runTurn } from './turn.service.js';

/**
 * Runs the agent and yields one typed, sequenced event per step.
 *
 * Aborting `signal` stops the run cleanly: the model stream is dropped, unfinished tools are
 * cancelled and recorded as interrupted, and the run ends with `done` (reason "interrupted").
 * It never throws because of an abort. Stopping iteration early (`break`) aborts the same way.
 */
export async function* streamAgent(options: AgentOptions): AsyncGenerator<AgentEvent> {
  const stop = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, stop.signal]) : stop.signal;
  const events = new OrderedQueue<AgentEventBody>();

  drive({ options, signal, aborted: whenAborted(signal), events }).then(
    () => events.close(),
    (caughtError: unknown) => events.fail(caughtError),
  );

  try {
    yield* events;
  } finally {
    stop.abort(); // no-op if the run already finished
  }
}

/** Convenience wrapper: runs to completion and returns the conversation. */
export async function runAgent(options: RunAgentOptions): Promise<Message[]> {
  for await (const event of streamAgent(options)) {
    options.onEvent?.(event);
    if (event.type === 'done') return event.messages;
  }

  throw new Error('Agent stream ended without a done event');
}

/** The loop itself: call the model, run requested tools, feed results back, repeat. */
async function drive(context: RunContext) {
  const { options, events, signal } = context;
  const { maxTurns = DEFAULT_MAX_TURNS, hooks = [] } = options;
  const messages = [...options.messages];
  let reason: DoneReason = 'max_turns';

  try {
    await runSessionStart({
      hooks,
      messages,
      signal,
      onContext: (added) => events.enqueue({ type: 'context_added', ...added }),
    });

    for (let turn = 1; turn <= maxTurns; turn++) {
      const ended = await runTurn({ ...context, turn, messages });

      if (ended) {
        reason = ended;
        break;
      }

      // Backpressure: the next model call waits until the consumer has handled this turn,
      // so anything it does in response (swap provider, steer, abort) applies to the next turn.
      await events.consumed();
    }
  } catch (caughtError) {
    await runOnError({ hooks, error: caughtError, messages });
    throw caughtError;
  }

  events.enqueue({ type: 'done', reason, messages });
}
