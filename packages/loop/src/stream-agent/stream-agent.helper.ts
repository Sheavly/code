import { whenAborted } from '../abort/abort.utils.js';
import { OrderedQueue } from '../queue/queue.service.js';
import { runOnError, runSessionStart } from '../hooks/hooks.helper.js';
import { StreamEndedError } from '../errors/loop.errors.js';
import { SessionError } from '@sheavly/runtime/errors/sessions.errors';
import { errorMessage } from '@sheavly/runtime/errors/errors.utils';
import { errorDetails } from '@sheavly/runtime/errors/error-details.utils';
import { redactDiagnosticText } from '@sheavly/runtime/errors/diagnostic-text.utils';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { RunSession } from '@sheavly/runtime/sessions/sessions.types';
import type {
  AgentOptions,
  RunAgentOptions,
  RunContext,
  TurnContext,
} from './stream-agent.types.js';
import { runTurn } from './turn.helper.js';
import type { AgentEvent, AgentEventBody, DoneReason } from '@sheavly/protocol/event/event.types';
import type { HistoryMessage } from '@sheavly/protocol/message/message.types';
import type { RunOutcome } from '@sheavly/protocol/session/session.types';

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
  const session = options.session ?? mainSession();
  // Each event joins the session tree's combined stream as it is released, with its `seq`.
  const events = new OrderedQueue<AgentEventBody>({
    onRelease: (event) => session.registry.publish({ sessionId: session.ref.id, event }),
  });

  drive({ options, session, signal, aborted: whenAborted(signal), events }).then(
    () => events.close(),
    (caughtError: unknown) => {
      // A session its registry doesn't know (the run's first check) has nothing to end.
      if (session.registry.get(session.ref.id)) {
        finishSession({ session, outcome: 'failed', keep: options.keepSession });
      }

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
export async function runAgent(options: RunAgentOptions): Promise<HistoryMessage[]> {
  return (await runSession(options)).messages;
}

/** Runs to completion and returns how the run ended and the conversation (e.g. a sub-agent's). */
export async function runSession(
  options: RunAgentOptions,
): Promise<{ reason: DoneReason; messages: HistoryMessage[] }> {
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
  const { maxTurns = Infinity, hooks = [] } = options;
  const messages = [...options.messages];
  const outputRecovery: TurnContext['outputRecovery'] = { attempts: 0, pending: undefined };
  const summaryFailures = { count: 0 };
  // Only reached when a cap was asked for: without one the loop ends by `break` or by throwing.
  let reason: DoneReason = 'max_turns';

  // Every event is published to the session's registry as it is released, mid-turn: a session
  // that registry doesn't know fails the run here, before anything ran, not halfway through.
  if (!session.registry.get(session.ref.id)) {
    throw new SessionError({
      reason: 'unknown_session',
      sessionId: session.ref.id,
      message: `Session ${session.ref.id} isn't in the registry the run was given`,
    });
  }

  try {
    // Once per session: a resumed one (a conversation's next prompt) already ran these.
    if (!options.resumed) {
      await runSessionStart({
        hooks,
        messages,
        signal,
        onContext: (added) => events.enqueue({ type: 'context_added', ...added }),
      });
    }

    for (let turn = 1; turn <= maxTurns; turn++) {
      const ended = await runTurn({ ...context, turn, messages, outputRecovery, summaryFailures });

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
        events.enqueue({
          type: 'hook_failed',
          hook,
          handler,
          error: redactDiagnosticText(message),
        }),
    });
    events.enqueue({
      type: 'run_failed',
      error: redactDiagnosticText(errorMessage(caughtError)),
      details: errorDetails(caughtError),
      session: session.ref,
    });
    // The API closes on the failed session update, so release the diagnostic first even when
    // earlier tool results or error hooks were queued. The original exception still reaches callers.
    await events.consumed();
    throw caughtError;
  }

  finishSession({ session, outcome: reason, keep: options.keepSession });
  events.enqueue({ type: 'done', reason, messages, session: session.ref });
}

/** The run is over: its session ends, or, kept for a conversation's next prompt, goes idle. */
function finishSession(params: {
  session: RunSession;
  outcome: RunOutcome;
  keep: boolean | undefined;
}): void {
  const { session, outcome, keep } = params;

  if (keep) session.registry.idle({ id: session.ref.id, outcome });
  else session.registry.end({ id: session.ref.id, state: outcome });
}
