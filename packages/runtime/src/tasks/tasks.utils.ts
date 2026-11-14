import { DEFAULT_TASK_OUTPUT_CHARS } from './tasks.constants.js';
import { outputReferenceLines } from '@sheavly/core/output/output.utils';
import type { RunningTask } from '@sheavly/protocol/notice/notice.types';
import type { TaskId, TaskInfo } from '@sheavly/protocol/task/task.types';

/**
 * A running task's metadata-only snapshot. `group` is the task's group's first requested ID, given
 * only when the caller may see the group; otherwise the reason falls back to the description.
 */
export function runningTaskOf(params: { info: TaskInfo; group: TaskId | undefined }): RunningTask {
  const { info, group } = params;

  return {
    id: info.id,
    title: info.description,
    reason: group ? (info.reason ?? info.description) : info.description,
    startedAt: info.startedAt,
    ...(group && { group }),
  };
}

/**
 * One readable block for the model: header line, command, then the task's result. A task that
 * returned a `report` shows it whole and nothing else of its output: the output is progress, and
 * the report is the result, which is never cut. Otherwise it is the output, its tail only when
 * longer than `outputChars`. `now` is the time a task still running is measured to; a finished
 * one ends at its own `endedAt`.
 */
export function formatTask(params: {
  task: TaskInfo;
  now: number;
  outputChars?: number;
  report?: string | undefined;
}): string {
  const { task, now, outputChars = DEFAULT_TASK_OUTPUT_CHARS, report } = params;
  const elapsed = ((task.endedAt ?? now) - task.startedAt) / 1000;
  const parts: string[] = [task.status];

  if (task.exitCode !== undefined) parts.push(`exit code ${task.exitCode ?? 'unknown'}`);
  parts.push(`${elapsed.toFixed(1)}s`);

  const preview =
    task.output.length > outputChars ? `[…]\n${task.output.slice(-outputChars)}` : task.output;
  const output = report ?? preview;
  // A task's own preview is cut to `outputChars`, so the reference is compared with what is shown.
  const reference =
    report === undefined ? outputReferenceLines({ log: task.outputLog, shown: preview }) : [];

  return [
    `[task ${task.id} · ${parts.join(' · ')}] $ ${task.command}`,
    task.error,
    output.trimEnd(),
    ...reference,
  ]
    .filter(Boolean)
    .join('\n');
}
