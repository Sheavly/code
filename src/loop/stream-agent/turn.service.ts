import type { Message } from '@sheavly/core/message/message.types';
import type { TaskRegistry } from '../../runtime/tasks/tasks.service.js';
import { taskNotification } from '../../runtime/tasks/tasks.utils.js';
import type { DoneReason } from '../events/events.types.js';
import { runAfterTurn, runBeforeTurn } from '../hooks/hooks.service.js';
import { sample } from './sample.service.js';
import type { AgentEvents, AgentOptions, RunningCall, TurnContext } from './stream-agent.types.js';

/** One model call plus its tool results. Returns why the run ends, or undefined to keep going. */
export async function runTurn(context: TurnContext): Promise<DoneReason | undefined> {
  const { options, turn, messages, signal, aborted, events } = context;

  if (signal.aborted) return 'interrupted';

  reportFinishedTasks({ tasks: options.tasks, messages, events });

  await runBeforeTurn({
    hooks: options.hooks ?? [],
    turn,
    messages,
    signal,
    onContext: (added) => events.enqueue({ type: 'context_added', ...added }),
  });

  if (signal.aborted) return 'interrupted';

  const { message, stopReason, running } = await sample({
    ...options,
    messages,
    signal,
    aborted,
    events,
  });
  // An interrupt before the model said anything leaves no trace in history.
  const empty = !message.content && message.toolCalls.length === 0 && !message.reasoning;

  if (!(signal.aborted && empty)) messages.push(message);

  events.enqueue({ type: 'turn_end', turn, stopReason });

  if (running.length > 0) messages.push(...(await releaseResults({ running, events })));

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

  // The model is done. Either end the run, or wait for a background task and continue.
  if (await awaitTask({ options, aborted })) return undefined;

  return signal.aborted ? 'interrupted' : 'completed';
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
 * With `waitForTasks`: true once a finished task is ready to report (waiting for one if needed).
 * False if there's nothing to wait for, or the run was aborted while waiting.
 */
async function awaitTask(params: {
  options: AgentOptions;
  aborted: Promise<void>;
}): Promise<boolean> {
  const { options, aborted } = params;
  const { tasks, waitForTasks } = options;

  if (!waitForTasks || !tasks) return false;

  while (!tasks.hasUnreported) {
    if (tasks.runningCount === 0) return false;
    const finished = await Promise.race([
      tasks.nextSettled().then(() => true),
      aborted.then(() => false),
    ]);

    if (!finished) return false;
    // Loop again: a task cancelled on request settles silently, with nothing to report.
  }

  return true;
}
