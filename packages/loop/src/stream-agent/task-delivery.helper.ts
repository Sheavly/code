import { now } from '@sheavly/core/clock/clock.helper';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';
import type { TaskInfo } from '@sheavly/protocol/task/task.types';
import type { RunSession } from '@sheavly/runtime/sessions/sessions.types';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import type { AgentEvents } from './stream-agent.types.js';
import { finishedTaskNotice } from './task-notice.helper.js';
import { taskCompletionContext } from './task-context.utils.js';

/**
 * Releases only ready deliveries at a turn boundary, identically to history and the stream.
 * Returns the tasks of each delivery, for the `taskCompleted` hooks.
 */
export function reportFinishedTasks(params: {
  tasks: TaskRegistry | undefined;
  session: RunSession;
  messages: HistoryMessage[];
  events: AgentEvents;
}): TaskInfo[][] {
  const { tasks, session, messages, events } = params;

  if (!tasks) return [];

  // Completion listeners may release any delivered task synchronously. Snapshot every report
  // before publishing the first event, including reports in later deliveries of this drain.
  const deliveries = tasks.takeDeliveries(session.ref.id).map((delivery) => ({
    ...delivery,
    notices: delivery.tasks.map((task) =>
      finishedTaskNotice({
        task,
        tasks,
        sessions: session.registry,
        parent: session.ref.id,
        history: messages,
      }),
    ),
    context:
      delivery.reason === undefined
        ? undefined
        : taskCompletionContext({
            reason: delivery.reason,
            startedAt: Math.min(...delivery.tasks.map((task) => task.startedAt)),
            endedAt: Math.max(...delivery.tasks.map((task) => task.endedAt ?? task.startedAt)),
            history: messages,
          }),
  }));

  for (const delivery of deliveries) {
    const { notices } = delivery;
    const notice: HarnessNotice | undefined =
      delivery.reason === undefined
        ? notices[0]
        : {
            kind: 'tasks-finished',
            reason: delivery.reason,
            notices,
            ...(delivery.context !== undefined && { context: delivery.context }),
          };

    if (!notice) continue;

    for (const task of delivery.tasks) events.enqueue({ type: 'task_completed', task });

    // One grouped event and history entry: no member notice leaks before the group is complete.
    events.enqueue({ type: 'harness_notice', notice });
    const at = Math.max(...delivery.tasks.map((task) => task.endedAt ?? now()));

    messages.push({ role: 'notice', notice, at });
  }

  // Every notice is built and in history, so nothing reads these tasks again. Silent settled
  // tasks go too: this turn's `cancel_task` result has reached the model by now.
  tasks.releaseFinished(session.ref.id);

  // `finishedTaskNotice` found each sub-agent by its session, so the session can go only now. A
  // failed or stopped sub-agent has no report, hence a `task-finished` notice, and goes too. One
  // with a session still open under it stays and is not retried.
  for (const delivery of deliveries) {
    for (const task of delivery.tasks) releaseAgentOf({ task, session });
  }

  return deliveries.map((delivery) => delivery.tasks);
}

/** Releases the sub-agent session the task's `start_agent` call started, if it started one. */
function releaseAgentOf(params: { task: TaskInfo; session: RunSession }): void {
  const { task, session } = params;

  if (task.callId === undefined) return;

  const agent = session.registry
    .children(session.ref.id)
    .find((child) => 'startedByCall' in child && child.startedByCall === task.callId);

  if (agent) session.registry.releaseAgent(agent.id);
}
