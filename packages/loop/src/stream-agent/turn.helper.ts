import { reportFinishedTasks } from './task-delivery.helper.js';
import { inboxText } from '@sheavly/runtime/sessions/sessions.utils';
import type { RunSession } from '@sheavly/runtime/sessions/sessions.types';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { contextState } from '../context/context.utils.js';
import { runAfterTurn, runBeforeModelCall, runBeforeTurn } from '../hooks/hooks.helper.js';
import { joinInstructions } from '../hooks/hooks.utils.js';
import { runNotice, runTaskCompleted } from '../hooks/new-points.helper.js';
import type { TaskInfo } from '@sheavly/protocol/task/task.types';
import { summarizeAtThreshold } from '../summary/summarize.helper.js';
import { viewWithoutCallReferences } from '../summary/summary.utils.js';
import { withNoticeCallReferences } from '../summary/model-notice.utils.js';
import { HookError } from '../errors/loop.errors.js';
import { sample } from './sample.helper.js';
import { runContribution } from './contributions.helper.js';
import type { AgentEvents, AgentOptions, RunningCall, TurnContext } from './stream-agent.types.js';
import type { DoneReason } from '@sheavly/protocol/event/event.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { Message, TurnStopReason } from '@sheavly/protocol/message/message.types';

/** One model call plus its tool results. Returns why the run ends, or undefined to keep going. */
export async function runTurn(context: TurnContext): Promise<DoneReason | undefined> {
  const { options, session, turn, messages, signal, aborted, events } = context;

  if (signal.aborted) return 'interrupted';

  // A follow-up already in the inbox belongs in the completion's messages-since snapshot.
  deliverMessages({ session, messages, events });
  const noticesFrom = messages.length;
  const delivered = reportFinishedTasks({ tasks: options.tasks, session, messages, events });

  // Handlers that failed since the last call: the model hears of them at this call, once.
  context.hookFailures.deliver(messages);
  await runDeliveryHooks({ context, delivered, noticesFrom });
  // After tasks and messages are in history, before any hook: hooks see the shortened state.
  // No summary could make room and the view fills the window: stop here, recoverably (the history
  // is untouched and valid), rather than send a call the provider is sure to reject.
  const room = await summarizeAtThreshold(context);

  // An abort during the summary ends the run as interrupted, whatever the view's size.
  if (signal.aborted) return 'interrupted';

  if (room === 'full') return 'context_window_exceeded';

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
    onHookError: context.hookFailures.report,
  });

  // For this call only: `messages` stays the stored history, and the turn appends to that. The
  // model is sent the view (the newest checkpoint as text, then the messages it kept).
  // Old large tool results are hidden here too when a summary is configured: it is the cheaper
  // first step, and it delays the summary instead of replacing it.
  const source = await shapeView({ context, view: viewWithoutCallReferences(messages) });
  const sent = await runBeforeModelCall({
    hooks: options.hooks ?? [],
    turn,
    messages: source,
    context: state,
    signal,
    onChanged: (change) => events.enqueue({ type: 'model_input_changed', turn, ...change }),
    onHookError: context.hookFailures.report,
  });

  // An abort during a hook ends the run as interrupted, like every other abort; nothing has been
  // added to history yet, so it stays valid.
  if (signal.aborted) return 'interrupted';

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
    onHookError: context.hookFailures.report,
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
    onHookError: context.hookFailures.report,
  });

  return finishTurn({ context, stopReason, running, reply: message });
}

/**
 * Runs the `taskCompleted` hooks once per delivery of finished work, then the `notice` hooks for
 * each persistent notice the harness wrote into history since `noticesFrom` (finished work and
 * failed hooks). Transient notices ride one call and are not offered. A `hook-failed` notice is
 * not offered to `notice` hooks: a hook failing on its own failure would repeat forever.
 */
async function runDeliveryHooks(params: {
  context: TurnContext;
  delivered: readonly TaskInfo[][];
  noticesFrom: number;
}): Promise<void> {
  const { context, delivered, noticesFrom } = params;
  const { options, messages, signal, events, hookFailures } = context;
  const base = {
    hooks: options.hooks ?? [],
    messages,
    signal,
    onContext: (added: { hook: string; content: string }) =>
      events.enqueue({ type: 'context_added', ...added }),
    onHookError: hookFailures.report,
  };

  for (const tasks of delivered) await runTaskCompleted({ ...base, tasks });

  const notices = messages
    .slice(noticesFrom)
    .flatMap((message) =>
      message.role === 'notice' && message.notice.kind !== 'hook-failed' ? [message.notice] : [],
    );

  for (const notice of notices) await runNotice({ ...base, notice });
}

/** Passes the view through each `view` contribution in order; the result is what the model sees. */
async function shapeView(params: {
  context: TurnContext;
  view: readonly Message[];
}): Promise<readonly Message[]> {
  const { context, view } = params;
  let current = view;

  for (const contribution of context.contributions.view) {
    const { value } = await runContribution({
      contribution,
      input: { view: current, window: context.options.provider.contextWindow },
      signal: context.signal,
      report: reportContribution(context),
    });

    current = value ?? current;
  }

  return current;
}

/** A skipped contribution is reported like a failed hook: `hook_failed`, and a model notice. */
function reportContribution(context: TurnContext) {
  return ({ name, error }: { name: string; error: unknown }) =>
    context.hookFailures.report(
      new HookError({ hook: name, handler: 'contribution', cause: error }),
    );
}

/**
 * A call the provider rejected as too long: the `overflow` contributions may recover and ask for
 * a retry. True when one did; the caller drops the rejected reply and the next turn calls the
 * model again. With none registered the run ends `context_window_exceeded`.
 */
async function retryAfterOverflow(params: {
  context: TurnContext;
  stopReason: TurnStopReason;
  /** The rejected call had already started tools: its history is not ours to rewind. */
  started: boolean;
}): Promise<boolean> {
  const { context } = params;

  for (const contribution of context.contributions.overflow) {
    const { value } = await runContribution({
      contribution,
      input: params,
      signal: context.signal,
      report: reportContribution(context),
    });

    if (value) return true;
  }

  return false;
}

/** The first `limit` contribution that takes the turn decides how it ends; none: carry on. */
async function limitOutcome(params: {
  context: TurnContext;
  stopReason: TurnStopReason;
  running: readonly RunningCall[];
  reply: HistoryMessage;
}): Promise<{ ended: DoneReason | undefined } | undefined> {
  const { context } = params;

  for (const contribution of context.contributions.limit) {
    const { value } = await runContribution({
      contribution,
      input: params,
      signal: context.signal,
      report: reportContribution(context),
    });

    if (value) return value;
  }

  return undefined;
}

/** Resolves recovery, pending work and completion only after results and afterTurn hooks. */
async function finishTurn(params: {
  context: TurnContext;
  stopReason: TurnStopReason;
  running: readonly RunningCall[];
  reply: HistoryMessage;
}): Promise<DoneReason | undefined> {
  const { context, stopReason, running, reply } = params;
  const { signal, session, options } = context;

  if (signal.aborted) return 'interrupted';

  const limited = await limitOutcome({ context, stopReason, running, reply });

  if (limited) return limited.ended;

  if (running.length > 0) return undefined;

  // Messages from a parent agent wake the model without touching tasks or groups. Otherwise finite work keeps
  // this session alive until its results can be delivered; services may outlive the run.
  if (session.registry.hasMessages(session.ref.id)) return undefined;

  // A requested yield outranks task completions: their results stay delivered to the next run.
  // It does not outrank `await_tasks`: the queued line waits until the model has finished.
  if (yieldEnds({ options, id: session.ref.id })) return 'completed';

  if (await awaitTask({ options, session, signal, events: context.events })) return undefined;

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
 * False if only services remain, or the run was aborted while waiting. While it waits, the run
 * says so with `run_state`, and says it works again when a delivery or message ends the wait.
 */
async function awaitTask(params: {
  options: AgentOptions;
  session: RunSession;
  signal: AbortSignal;
  events: AgentEvents;
}): Promise<boolean> {
  const { options, session, signal, events } = params;
  const { tasks } = options;
  const { registry, ref } = session;

  if (!tasks) return false;

  let reported: number | undefined;
  let waitedOnGroup = false;

  while (!tasks.hasDeliveries(ref.id) && !registry.hasMessages(ref.id)) {
    if (!holdsRunOpen({ options, tasks, id: ref.id })) return false;
    // An aborted yield resolves every further wait at once, so it must end the loop here.
    if (yieldEnds({ options, id: ref.id })) return false;
    const groupedTasks = tasks.groupedPendingCount(ref.id);

    reported = reportWaiting({ groupedTasks, reported, events });
    waitedOnGroup = groupedTasks > 0;
    // Grouped work ignores the yield, so a wait on it must not resolve at once.
    const yieldSignal = waitedOnGroup ? undefined : options.yieldSignal;
    const woken = await waitForWake({ tasks, registry, id: ref.id, signal, yieldSignal });

    if (!woken) return false;
    // Loop again: a task cancelled on request settles silently, with nothing to report.
  }

  // A yield that raced an ungrouped delivery wins: the delivery stays for the next run. Not when
  // the wait was on grouped work: the model must see what it waited for, and finish, before the
  // queued line starts (`finishTurn` then ends the run on the yield).
  if (!waitedOnGroup && yieldEnds({ options, id: ref.id })) return false;

  if (reported !== undefined) {
    events.enqueue({ type: 'run_state', state: 'working', groupedTasks: 0 });
  }

  return true;
}

/** Whether work still running keeps this run open, as `options.holdOpenFor` says. */
function holdsRunOpen(params: {
  options: AgentOptions;
  tasks: TaskRegistry;
  id: RunSession['ref']['id'];
}): boolean {
  const { options, tasks, id } = params;

  return options.holdOpenFor === 'awaited' ? tasks.hasAwaitedTasks(id) : tasks.hasPendingTasks(id);
}

/**
 * Whether a requested yield ends the run now. Grouped work (`await_tasks`) is the one thing a
 * yield does not end: the queued line stays queued until the model has finished.
 */
function yieldEnds(params: { options: AgentOptions; id: RunSession['ref']['id'] }): boolean {
  const { options, id } = params;

  return options.yieldSignal?.aborted === true && !options.tasks?.hasAwaitedTasks(id);
}

/** Tells a UI the run waits on this many grouped tasks, unless it was last told the same. */
function reportWaiting(params: {
  groupedTasks: number;
  reported: number | undefined;
  events: AgentEvents;
}): number {
  const { groupedTasks, reported, events } = params;

  if (groupedTasks !== reported) {
    events.enqueue({ type: 'run_state', state: 'waiting', groupedTasks });
  }

  return groupedTasks;
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
