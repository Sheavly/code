import { DEFAULT_TASK_OUTPUT_CHARS } from './tasks.constants.js';
import type { TaskInfo } from '@sheavly/protocol/task/task.types';

/**
 * One readable block for the model: header line, command, then output (tail only if asked).
 * `now` is the time a task still running is measured to; a finished one ends at its own `endedAt`.
 */
export function formatTask(params: { task: TaskInfo; now: number; outputChars?: number }): string {
  const { task, now, outputChars = DEFAULT_TASK_OUTPUT_CHARS } = params;
  const elapsed = ((task.endedAt ?? now) - task.startedAt) / 1000;
  const parts: string[] = [task.status];

  if (task.exitCode !== undefined) parts.push(`exit code ${task.exitCode ?? 'unknown'}`);
  parts.push(`${elapsed.toFixed(1)}s`);

  const output =
    task.output.length > outputChars ? `[…]\n${task.output.slice(-outputChars)}` : task.output;

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
