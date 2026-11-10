import { DEFAULT_TASK_OUTPUT_CHARS } from './tasks.constants.js';
import type { TaskInfo } from '@sheavly/protocol/task/task.types';

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

  return [
    `[task ${task.id} · ${parts.join(' · ')}] $ ${task.command}`,
    task.error,
    output.trimEnd(),
  ]
    .filter(Boolean)
    .join('\n');
}

/** The message the loop adds to history so the model learns a task finished. */
export function taskNotification(task: TaskInfo): string {
  // Finished, so its elapsed time ends at its own `endedAt`; `now` only matters while it runs.
  return `Background task finished:\n${formatTask({ task, now: task.endedAt ?? task.startedAt })}`;
}
