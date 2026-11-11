import { now } from '@sheavly/core/clock/clock.helper';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';
import type { RunSession } from '@sheavly/runtime/sessions/sessions.types';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import type { AgentEvents } from './stream-agent.types.js';
import { finishedTaskNotice } from './task-notice.helper.js';
import { taskCompletionContext } from './task-context.utils.js';

/** Releases only ready deliveries at a turn boundary, identically to history and the stream. */
export function reportFinishedTasks(params: {
  tasks: TaskRegistry | undefined;
  session: RunSession;
  messages: HistoryMessage[];
  events: AgentEvents;
}): void {
  const { tasks, session, messages, events } = params;

  if (!tasks) return;

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
}
