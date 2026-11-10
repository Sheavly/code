import { now } from '@sheavly/core/clock/clock.helper';
import { inboxText } from '@sheavly/runtime/sessions/sessions.utils';
import type { RunSession } from '@sheavly/runtime/sessions/sessions.types';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { contextState } from '../context/context.utils.js';
import { runAfterTurn, runBeforeModelCall, runBeforeTurn } from '../hooks/hooks.helper.js';
import { joinInstructions } from '../hooks/hooks.utils.js';
import { summarizeAtThreshold, summarizeHistory } from '../summary/summarize.helper.js';
import { viewOf } from '../summary/summary.utils.js';
import { sample } from './sample.helper.js';
import { finishedTaskNotice } from './task-notice.helper.js';
import { continueAfterOutputLimit } from './output-recovery.helper.js';
import type { AgentEvents, AgentOptions, RunningCall, TurnContext } from './stream-agent.types.js';
import type { DoneReason } from '@sheavly/protocol/event/event.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { TurnStopReason } from '@sheavly/protocol/message/message.types';

/** One model call plus its tool results. Returns why the run ends, or undefined to keep going. */
export async function runTurn(context: TurnContext): Promise<DoneReason | undefined> {
  const { options, session, turn, messages, signal, aborted, events } = context;

  if (signal.aborted) return 'interrupted';

  reportFinishedTasks({ tasks: options.tasks, session, messages, events });
  deliverMessages({ session, messages, events });
  // After tasks and messages are in history, before any hook: hooks see the shortened state.
  await summarizeAtThreshold(context);

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
  const sent = await runBeforeModelCall({
    hooks: options.hooks ?? [],
    turn,
    messages: viewOf(messages),
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
    messages: sent,
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
  const { signal, session, options, aborted } = context;

  if (signal.aborted) return 'interrupted';

  if (stopReason === 'context_window_exceeded') return 'context_window_exceeded';
  if (stopReason === 'max_tokens') return continueAfterOutputLimit(context);

  if (running.length > 0) return undefined;

  // The model is done. A message that came in meanwhile gets another turn, as does a finished
  // required background task (or any task with `waitForTasks`); otherwise the run ends.
  if (session.registry.hasMessages(session.ref.id)) return undefined;

  if (await awaitTask({ options, session, aborted })) return undefined;

  return signal.aborted ? 'interrupted' : 'completed';
}

/**
 * Messages sent to this session while it worked (user steering, or its parent's): put in
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

/** Tasks that finished since the last turn: shown in order, and told to the model before it runs. */
function reportFinishedTasks(params: {
  tasks: TaskRegistry | undefined;
  session: RunSession;
  messages: HistoryMessage[];
  events: AgentEvents;
}): void {
  const { tasks, session, messages, events } = params;

  if (!tasks) return;

  for (const task of tasks.takeUnreported()) {
    // The same payload goes to the stream and into history, so a UI sees it live and on reopening.
    const notice = finishedTaskNotice({
      task,
      tasks,
      sessions: session.registry,
      parent: session.ref.id,
    });

    events.enqueue({ type: 'task_completed', task });
    events.enqueue({ type: 'harness_notice', notice });
    messages.push({ role: 'notice', notice, at: task.endedAt ?? now() });
  }
}

/**
 * Queues the turn's results in call order (each is released after the turn ended and the
 * previous result) and returns them for history, also in call order. Every call gets a result,
 * real or "interrupted", so history stays valid.
 */
async function releaseResults(params: {
  running: RunningCall[];
  events: AgentEvents;
}): Promise<HistoryMessage[]> {
  const { running, events } = params;

  events.enqueue({ type: 'tool_batch', calls: running.map((r) => r.described) });

  for (const { outcome } of running) events.enqueue(outcome);

  const outcomes = await Promise.all(running.map((r) => r.outcome));

  return outcomes.map((o) => o.message);
}

/**
 * Required tasks always keep the run alive; waitForTasks also includes ordinary background work.
 * False if there's nothing left to wait for, or the run was aborted while waiting.
 */
async function awaitTask(params: {
  options: AgentOptions;
  session: RunSession;
  aborted: Promise<void>;
}): Promise<boolean> {
  const { options, session, aborted } = params;
  const { tasks, waitForTasks } = options;
  const { registry, ref } = session;

  if (!tasks || (!waitForTasks && !tasks.hasRequiredTasks)) return false;

  while (!tasks.hasUnreported && !registry.hasMessages(ref.id)) {
    if (tasks.runningCount === 0 || (!waitForTasks && !tasks.hasRequiredTasks)) return false;
    const woken = await Promise.race([
      tasks.nextSettled().then(() => true),
      registry.nextMessage(ref.id).then(() => true),
      aborted.then(() => false),
    ]);

    if (!woken) return false;
    // Loop again: a task cancelled on request settles silently, with nothing to report.
  }

  return true;
}
