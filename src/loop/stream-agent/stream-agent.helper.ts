import { whenAborted } from '../abort/abort.utils.js';
import { OrderedQueue } from '../queue/queue.service.js';
import { DEFAULT_MAX_TURNS } from './stream-agent.constants.js';
import { runOnError, runSessionStart } from '../hooks/hooks.helper.js';
import { StreamEndedError } from '../../runtime/errors/hooks.errors.js';
import { SessionRegistry } from '../../runtime/sessions/sessions.service.js';
import type { RunSession } from '../../runtime/sessions/sessions.types.js';
import type { AgentOptions, RunAgentOptions, RunContext } from './stream-agent.types.js';
import { runTurn } from './turn.helper.js';
import type { AgentEvent, AgentEventBody, DoneReason } from '@sheavly/protocol/event/event.types';
import type { Message } from '@sheavly/protocol/message/message.types';

/**
 * Runs the agent and yields one typed, sequenced event per step.
 *
 * Every run is a session: the one in `options.session` (a sub-agent's, from its parent), or a
 * new main session. The session is ended with the run's outcome, and `done` names it.
 *
 * Aborting `signal` stops the run cleanly: the model stream is dropped, unfinished tools are
 * cancelled and recorded as interrupted, and the run ends with `done` (reason "interrupted").
 * It never throws because of an abort. Stopping iteration early (`break`) aborts the same way.
 */
export async function* streamAgent(options: AgentOptions): AsyncGenerator<AgentEvent> {
  const stop = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, stop.signal]) : stop.signal;
  const events = new OrderedQueue<AgentEventBody>();
  const session = options.session ?? mainSession();

  drive({ options, session, signal, aborted: whenAborted(signal), events }).then(
    () => events.close(),
    (caughtError: unknown) => {
      session.registry.end({ id: session.ref.id, state: 'failed' });
      events.fail(caughtError);
    },
  );

  try {
    yield* events;
  } finally {
    stop.abort(); // no-op if the run already finished
  }
}

/** Convenience wrapper: runs to completion and returns the conversation. */
export async function runAgent(options: RunAgentOptions): Promise<Message[]> {
  return (await runSession(options)).messages;
}

/** Runs to completion and returns how the run ended and the conversation (e.g. a sub-agent's). */
export async function runSession(
  options: RunAgentOptions,
): Promise<{ reason: DoneReason; messages: Message[] }> {
  for await (const event of streamAgent(options)) {
    options.onEvent?.(event);
    if (event.type === 'done') return { reason: event.reason, messages: event.messages };
  }

  throw new StreamEndedError();
}

/** A run with no session given is a main session, in a registry of its own. */
function mainSession(): RunSession {
  const registry = new SessionRegistry();

  return { registry, ref: registry.startMain({ title: 'Main session' }) };
}

/** The loop itself: call the model, run requested tools, feed results back, repeat. */
async function drive(context: RunContext) {
  const { options, session, events, signal } = context;
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
    await runOnError({
      hooks,
      error: caughtError,
      messages,
      onHookError: ({ hook, handler, message }) =>
        events.enqueue({ type: 'hook_failed', hook, handler, error: message }),
    });
    throw caughtError;
  }

  session.registry.end({ id: session.ref.id, state: reason });
  events.enqueue({ type: 'done', reason, messages, session: session.ref });
}
