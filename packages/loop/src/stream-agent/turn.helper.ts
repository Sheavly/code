import { reportFinishedTasks } from './task-delivery.helper.js';
import { inboxText } from '@sheavly/runtime/sessions/sessions.utils';
import type { RunSession } from '@sheavly/runtime/sessions/sessions.types';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { contextState } from '../context/context.utils.js';
import { runAfterTurn, runBeforeModelCall, runBeforeTurn } from '../hooks/hooks.helper.js';
import { joinInstructions } from '../hooks/hooks.utils.js';
import { summarizeAtThreshold, summarizeHistory } from '../summary/summarize.helper.js';
import { viewWithoutCallReferences } from '../summary/summary.utils.js';
import { withNoticeCallReferences } from '../summary/model-notice.utils.js';
import { sample } from './sample.helper.js';
import { continueAfterOutputLimit } from './output-recovery.helper.js';
import type { AgentEvents, AgentOptions, RunningCall, TurnContext } from './stream-agent.types.js';
import type { DoneReason } from '@sheavly/protocol/event/event.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { TurnStopReason } from '@sheavly/protocol/message/message.types';

/** One model call plus its tool results. Returns why the run ends, or undefined to keep going. */
export async function runTurn(context: TurnContext): Promise<DoneReason | undefined> {
  const { options, session, turn, messages, signal, aborted, events } = context;

  if (signal.aborted) return 'interrupted';

  // A follow-up already in the inbox belongs in the completion's messages-since snapshot.
  deliverMessages({ session, messages, events });
  reportFinishedTasks({ tasks: options.tasks, session, messages, events });
  // After tasks and messages are in history, before any hook: hooks see the shortened state.
  // No summary could make room and the view fills the window: stop here, recoverably (the history
  // is untouched and valid), rather than send a call the provider is sure to reject.
  if ((await summarizeAtThreshold(context)) === 'full') return 'context_window_exceeded';

  if (signal.aborted) return 'interrupted';

  // Read once, so the hooks, the agent and the usage event all see the same numbers.
  const state = contextState({
    window: options.provider.contextWindow,
    lastTokens: session.registry.lastTokens(session.ref.id),
  });
  const instructions = await runBeforeTurn({
    hooks: options.hooks ?? [],
    turn,
    messages,
    context: state,
    signal,
    onContext: (added) => events.enqueue({ type: 'context_added', ...added }),
  });

  // For this call only: `messages` stays the stored history, and the turn appends to that. The
  // model is sent the view (the newest checkpoint as text, then the messages it kept).
  const source = viewWithoutCallReferences(messages);
  const sent = await runBeforeModelCall({
    hooks: options.hooks ?? [],
    turn,
    messages: source,
    context: state,
    signal,
    onChanged: (change) => events.enqueue({ type: 'model_input_changed', turn, ...change }),
  }).catch((caughtError: unknown) => {
    // A hook that fails because the run was aborted ends it as interrupted, like every other
    // abort; nothing has been added to history yet, so it stays valid.
    if (signal.aborted) return undefined;

    throw caughtError;
  });

  if (!sent || signal.aborted) return 'interrupted';

  const continuation = context.outputRecovery.pending;

  context.outputRecovery.pending = undefined;
  const { message, stopReason, running, failure } = await sample({
    ...options,
    instructions: joinInstructions([options.instructions, ...instructions]),
    session: session.ref,
    messages: withNoticeCallReferences({ history: messages, source, messages: sent }),
    state,
    continuation,
    signal,
    aborted,
    events,
  });

  // A failed model call that started no tools fails the turn as it is, with nothing to record.
  if (failure && running.length === 0) throw failure.error;

  if (await retryAfterOverflow({ context, stopReason, started: running.length > 0 })) {
    // The rejected reply is dropped from history, but a UI that saw the call start sees it end.
    events.enqueue({ type: 'turn_end', turn, stopReason });

    return undefined;
  }

  // An interrupt before the model said anything leaves no trace in history.
  const empty = !message.content && message.toolCalls.length === 0 && !message.reasoning;

  if (!(signal.aborted && empty)) messages.push(message);

  events.enqueue({ type: 'turn_end', turn, stopReason });

  if (running.length > 0) messages.push(...(await releaseResults({ running, events })));

  // The failed model call's tools are stopped and recorded; now the run fails with its error.
  if (failure) throw failure.error;

  await runAfterTurn({
    hooks: options.hooks ?? [],
    turn,
    stopReason,
    reply: message,
    messages,
    signal,
  });

  return finishTurn({ context, stopReason, running });
}

/**
 * A call the provider rejected as too long gets one summary and a retry, once per model call (a
 * call that ends any other way re-arms it), so it cannot loop. True when a checkpoint was
 * appended: the caller drops the rejected reply and the next turn calls the model again. If the
 * summary fails, or none is configured, the run ends `context_window_exceeded` as before. The
 * retry uses a turn, so `maxTurns` still bounds the run.
 */
async function retryAfterOverflow(params: {
  context: TurnContext;
  stopReason: TurnStopReason;
  /** The rejected call had already started tools: its history is not ours to rewind. */
  started: boolean;
}): Promise<boolean> {
  const { context, stopReason, started } = params;
  const { summaryFailures } = context;

  if (stopReason !== 'context_window_exceeded') {
    summaryFailures.overflowTried = false;

    return false;
  }

  if (started || summaryFailures.overflowTried || !context.options.summary) return false;

  summaryFailures.overflowTried = true;

  return summarizeHistory({ context, reason: 'overflow' });
}

/** Resolves recovery, pending work and completion only after results and afterTurn hooks. */
async function finishTurn(params: {
  context: TurnContext;
  stopReason: TurnStopReason;
  running: readonly RunningCall[];
}): Promise<DoneReason | undefined> {
  const { context, stopReason, running } = params;
  const { signal, session, options } = context;

  if (signal.aborted) return 'interrupted';

  if (stopReason === 'context_window_exceeded') return 'context_window_exceeded';
  if (stopReason === 'max_tokens') return continueAfterOutputLimit(context);

  if (running.length > 0) return undefined;

  // Messages from a parent agent wake the model without touching tasks or groups. Otherwise finite work keeps
  // this session alive until its results can be delivered; services may outlive the run.
  if (session.registry.hasMessages(session.ref.id)) return undefined;

  // A requested yield outranks task completions: their results stay delivered to the next run.
  if (options.yieldSignal?.aborted) return 'completed';

  if (await awaitTask({ options, session, signal })) return undefined;

  return signal.aborted ? 'interrupted' : 'completed';
}

/**
 * Messages sent to this session while it worked (its parent's, for example): put in
 * history as user messages before the model call, and shown in order, like finished tasks.
 */
function deliverMessages(params: {
  session: RunSession;
  messages: HistoryMessage[];
  events: AgentEvents;
}): void {
  const { session, messages, events } = params;

  for (const message of session.registry.takeMessages(session.ref.id)) {
    events.enqueue({ type: 'message_received', message });
    // The message is stamped with when it was sent, not when this turn read it.
    messages.push({ role: 'user', content: inboxText(message), at: message.sentAt });
  }
}

/**
 * Queues each result the moment its tool finishes, after the turn ended and `tool_batch`, so a
 * fast tool is never held back by a slow one called before it. A UI matches a result to its call
 * by id. History is returned in call order, which is what the model needs next. Every call gets a
 * result, real or "interrupted", so history stays valid.
 */
async function releaseResults(params: {
  running: RunningCall[];
  events: AgentEvents;
}): Promise<HistoryMessage[]> {
  const { running, events } = params;

  events.enqueue({ type: 'tool_batch', calls: running.map((r) => r.described) });

  // One synchronous pass, so a call is either already finished or waited for below, never both.
  // Finished ones go out first, in the order they finished; the rest as each one finishes.
  const early = running
    .flatMap(({ settled }) => (settled ? [settled] : []))
    .sort((a, b) => a.order - b.order);
  const late = running.filter(({ settled }) => !settled);

  for (const { outcome } of early) events.enqueue(outcome);

  // Enqueued as a settled value, not as the promise: the queue holds a pending item up and
  // everything behind it, which would put results back in call order.
  await Promise.all(
    late.map(async ({ outcome }) => {
      events.enqueue(await outcome);
    }),
  );

  const outcomes = await Promise.all(running.map((r) => r.outcome));

  return outcomes.map((o) => o.message);
}

/**
 * Finite work keeps its session alive until results are delivered, individually or as a group.
 * False if only services remain, or the run was aborted while waiting.
 */
async function awaitTask(params: {
  options: AgentOptions;
  session: RunSession;
  signal: AbortSignal;
}): Promise<boolean> {
  const { options, session, signal } = params;
  const { tasks } = options;
  const { registry, ref } = session;

  if (!tasks) return false;

  const { yieldSignal } = options;

  while (!tasks.hasDeliveries(ref.id) && !registry.hasMessages(ref.id)) {
    if (!tasks.hasPendingTasks(ref.id)) return false;
    const woken = await waitForWake({ tasks, registry, id: ref.id, signal, yieldSignal });

    if (!woken) return false;
    // An aborted yield resolves every further wait at once, so it must end the loop here.
    if (yieldSignal?.aborted) return false;
    // Loop again: a task cancelled on request settles silently, with nothing to report.
  }

  // A yield that raced a delivery wins over continuing.
  return !yieldSignal?.aborted;
}

/**
 * Waits for a task to finish or a message to arrive; false if the run aborted first. Whichever
 * wait did not fire is cancelled before returning, so each pass leaves no waiter in the
 * registries.
 */
async function waitForWake(params: {
  tasks: TaskRegistry;
  registry: RunSession['registry'];
  id: RunSession['ref']['id'];
  signal: AbortSignal;
  /** Aborting it also ends the wait; the caller decides what a yield means. */
  yieldSignal: AbortSignal | undefined;
}): Promise<boolean> {
  const { tasks, registry, id, signal, yieldSignal } = params;
  const done = new AbortController();
  const waits = AbortSignal.any([signal, done.signal, ...(yieldSignal ? [yieldSignal] : [])]);

  try {
    await Promise.race([tasks.nextSettled(waits), registry.nextMessage(id, waits)]);

    return !signal.aborted;
  } finally {
    done.abort();
  }
}
