import {
  MAX_RUNNING_TASKS,
  MAX_RUNNING_TASK_TITLE_CHARS,
  MAX_RUNNING_TASK_REASON_CHARS,
} from '@sheavly/protocol/notice/notice.constants';
import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';

/** Reads current session-compatible tasks for this call, never from the compacted history. */
export function runningTasksNotice(params: {
  tasks: TaskRegistry | undefined;
  sessionId: SessionId;
}): Extract<HarnessNotice, { kind: 'running-tasks' }> | undefined {
  const { tasks, sessionId } = params;
  const running = tasks?.runningTasks(sessionId) ?? [];

  if (running.length === 0) return undefined;

  // Reversing first gives the most recently registered task priority when clocks tie.
  const latest = running
    .toReversed()
    .toSorted((left, right) => right.startedAt - left.startedAt)
    .slice(0, MAX_RUNNING_TASKS)
    .map((task) => ({
      ...task,
      title: boundedText({ text: task.title, maxChars: MAX_RUNNING_TASK_TITLE_CHARS }),
      reason: boundedText({ text: task.reason, maxChars: MAX_RUNNING_TASK_REASON_CHARS }),
    }));

  return {
    kind: 'running-tasks',
    tasks: latest,
    total: running.length,
    omitted: running.length - latest.length,
  };
}

function boundedText(params: { text: string; maxChars: number }): string {
  const { text, maxChars } = params;

  if (text.length <= maxChars) return text;

  return `${text.slice(0, maxChars - 1)}…`;
}
