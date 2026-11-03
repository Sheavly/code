import { inboxText } from '@sheavly/runtime/sessions/sessions.utils';
import type { RunSession } from '@sheavly/runtime/sessions/sessions.types';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { taskNotification } from '@sheavly/runtime/tasks/tasks.utils';
import { runAfterTurn, runBeforeTurn } from '../hooks/hooks.helper.js';
import { joinInstructions } from '../hooks/hooks.utils.js';
import { sample } from './sample.helper.js';
import type { AgentEvents, AgentOptions, RunningCall, TurnContext } from './stream-agent.types.js';
import type { DoneReason } from '@sheavly/protocol/event/event.types';
import type { Message } from '@sheavly/protocol/message/message.types';

/** One model call plus its tool results. Returns why the run ends, or undefined to keep going. */
export async function runTurn(context: TurnContext): Promise<DoneReason | undefined> {
  const { options, session, turn, messages, signal, aborted, events } = context;

  if (signal.aborted) return 'interrupted';

  reportFinishedTasks({ tasks: options.tasks, messages, events });
  deliverMessages({ session, messages, events });

  const instructions = await runBeforeTurn({
    hooks: options.hooks ?? [],
    turn,
    messages,
    signal,
    onContext: (added) => events.enqueue({ type: 'context_added', ...added }),
  });

  if (signal.aborted) return 'interrupted';

  const { message, stopReason, running, failure } = await sample({
    ...options,
    instructions: joinInstructions([options.instructions, ...instructions]),
    session: session.ref,
    messages,
    signal,
    aborted,
    events,
  });

  // A failed model call that started no tools fails the turn as it is, with nothing to record.
  if (failure && running.length === 0) throw failure.error;

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

  if (signal.aborted) return 'interrupted';

  if (running.length > 0) return undefined;

  // The model is done. A message that came in meanwhile gets another turn, as does a finished
  // background task (or a message) while waiting, with `waitForTasks`; otherwise the run ends.
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
  messages: Message[];
  events: AgentEvents;
}): void {
  const { session, messages, events } = params;

  for (const message of session.registry.takeMessages(session.ref.id)) {
    events.enqueue({ type: 'message_received', message });
    messages.push({ role: 'user', content: inboxText(message) });
  }
}

/** Tasks that finished since the last turn: shown in order, and told to the model before it runs. */
function reportFinishedTasks(params: {
  tasks: TaskRegistry | undefined;
  messages: Message[];
  events: AgentEvents;
}): void {
  const { tasks, messages, events } = params;

  for (const task of tasks?.takeUnreported() ?? []) {
    events.enqueue({ type: 'task_completed', task });
    messages.push({ role: 'user', content: taskNotification(task) });
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
}): Promise<Message[]> {
  const { running, events } = params;

  events.enqueue({ type: 'tool_batch', calls: running.map((r) => r.described) });

  for (const { outcome } of running) events.enqueue(outcome);

  const outcomes = await Promise.all(running.map((r) => r.outcome));

  return outcomes.map((o) => o.message);
}

/**
 * With `waitForTasks`: true once a finished task or a new message is ready (waiting for one if
 * needed). False if there's nothing to wait for, or the run was aborted while waiting.
 */
async function awaitTask(params: {
  options: AgentOptions;
  session: RunSession;
  aborted: Promise<void>;
}): Promise<boolean> {
  const { options, session, aborted } = params;
  const { tasks, waitForTasks } = options;
  const { registry, ref } = session;

  if (!waitForTasks || !tasks) return false;

  while (!tasks.hasUnreported && !registry.hasMessages(ref.id)) {
    if (tasks.runningCount === 0) return false;
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
