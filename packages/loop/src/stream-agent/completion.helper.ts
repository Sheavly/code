import type { RunSession } from '@sheavly/runtime/sessions/sessions.types';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import type { AgentEvents, AgentOptions } from './stream-agent.types.js';

/**
 * Finite work keeps its session alive until results are delivered, individually or as a group.
 * False if only services remain, or the run was aborted while waiting. While it waits, the run
 * says so with `run_state`, and says it works again when a delivery or message ends the wait.
 */
export async function awaitTask(params: {
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
  // queued line starts (the `yield` completion contribution then ends the run).
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
export function yieldEnds(params: { options: AgentOptions; id: RunSession['ref']['id'] }): boolean {
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
