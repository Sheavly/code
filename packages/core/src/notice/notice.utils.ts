import type {
  HarnessNotice,
  RunningTask,
  RunningTasksNotice,
  TaskCompletionContext,
} from '@sheavly/protocol/notice/notice.types';
import { escapeTags, fenceDashes, oneLine } from '../text/text.utils.js';
import {
  AGENT_REPORT_NOTICE_TEXT,
  CONTEXT_USAGE_NOTICE_TEXT,
  OUTPUT_CONTINUATION_NOTICE_TEXT,
  RUNNING_TASKS_NOTICE_TEXT,
  TASK_COMPLETION_CONTEXT_TEXT,
  TASK_FINISHED_NOTICE_TEXT,
  TASKS_FINISHED_NOTICE_TEXT,
} from './notice.constants.js';

const count = new Intl.NumberFormat('en-US');

/** Formats trusted harness data with its origin and handling policy, never as a user request. */
export function formatHarnessNotice(notice: HarnessNotice): string {
  switch (notice.kind) {
    case 'running-tasks':
      return formatRunningTasks(notice);
    case 'context-usage':
      return [
        CONTEXT_USAGE_NOTICE_TEXT.opening,
        CONTEXT_USAGE_NOTICE_TEXT.origin,
        contextDescription(notice.context),
        CONTEXT_USAGE_NOTICE_TEXT.guidance,
        CONTEXT_USAGE_NOTICE_TEXT.closing,
      ].join('\n');
    case 'output-continuation':
      return [
        OUTPUT_CONTINUATION_NOTICE_TEXT.opening,
        OUTPUT_CONTINUATION_NOTICE_TEXT.origin,
        OUTPUT_CONTINUATION_NOTICE_TEXT.guidance,
        OUTPUT_CONTINUATION_NOTICE_TEXT.closing,
      ].join('\n');
    case 'agent-report':
      return [
        AGENT_REPORT_NOTICE_TEXT.opening,
        formatAgentReport(notice),
        AGENT_REPORT_NOTICE_TEXT.closing,
      ].join('\n');
    case 'task-finished':
      return [
        TASK_FINISHED_NOTICE_TEXT.opening,
        formatTaskFinished(notice),
        TASK_FINISHED_NOTICE_TEXT.closing,
      ].join('\n');
    case 'tasks-finished':
      return formatTasksFinished(notice);
  }
}

/** Live metadata stays outside agent-authored reason fences; no command or output is included. */
function formatRunningTasks(notice: RunningTasksNotice): string {
  return [
    RUNNING_TASKS_NOTICE_TEXT.opening,
    RUNNING_TASKS_NOTICE_TEXT.origin,
    `Running tasks: total ${String(notice.total)} · omitted ${String(notice.omitted)}`,
    RUNNING_TASKS_NOTICE_TEXT.guidance,
    ...notice.tasks.map(formatRunningTask),
    RUNNING_TASKS_NOTICE_TEXT.closing,
  ].join('\n');
}

function formatRunningTask(task: RunningTask): string {
  const group = task.group === undefined ? '' : ` · group ${line(task.group)}`;
  const reason = escapeTags(task.reason);
  const fence = fenceDashes(reason);

  return [
    `[task ${line(task.id)} · title "${line(task.title)}"${group} · startedAt ${String(task.startedAt)} (epoch milliseconds)]`,
    RUNNING_TASKS_NOTICE_TEXT.reasonOrigin,
    `${fence} ${RUNNING_TASKS_NOTICE_TEXT.reasonOpening} ${fence}`,
    reason,
    `${fence} ${RUNNING_TASKS_NOTICE_TEXT.reasonClosing} ${fence}`,
  ].join('\n');
}

/**
 * A sub-agent's report, whole, between fixed lines. Its text is model-written and may carry
 * injected instructions, so only its angle brackets are swapped (it cannot close the envelope) and
 * the rest is left as the sub-agent wrote it.
 */
function formatAgentReport(notice: Extract<HarnessNotice, { kind: 'agent-report' }>): string {
  const { agent, taskId, outcome, report } = notice;
  const status = agent.status ? ` Last status it reported: ${line(agent.status)}.` : '';
  const body = escapeTags(report);
  const fence = fenceDashes(body);

  return [
    AGENT_REPORT_NOTICE_TEXT.origin,
    `Sub-agent "${line(agent.title)}" (session ${line(agent.id)}, task ${line(taskId)}) ended: ${line(outcome)}.${status}`,
    ...formatCompletionContext(notice.context),
    AGENT_REPORT_NOTICE_TEXT.guidance,
    `${fence} ${AGENT_REPORT_NOTICE_TEXT.reportOpening} ${fence}`,
    body,
    `${fence} ${AGENT_REPORT_NOTICE_TEXT.reportClosing} ${fence}`,
  ].join('\n');
}

/** A header field as one escaped line: the harness made most of them, but history is a file. */
function line(text: string): string {
  return oneLine(escapeTags(text));
}

/** A finished task: how it ended, and its bounded output preview as data. */
function formatTaskFinished(notice: Extract<HarnessNotice, { kind: 'task-finished' }>): string {
  const { task } = notice;
  const elapsed = ((task.endedAt ?? task.startedAt) - task.startedAt) / 1000;
  const parts: string[] = [line(task.status)];

  if (task.exitCode !== undefined) parts.push(`exit code ${task.exitCode ?? 'unknown'}`);
  parts.push(`${Math.max(0, elapsed).toFixed(1)}s`);

  // The error and the output are both what the command printed: data, fenced together.
  const body = escapeTags([task.error, task.output.trimEnd()].filter(Boolean).join('\n'));
  const fence = fenceDashes(body);

  return [
    TASK_FINISHED_NOTICE_TEXT.origin,
    `[task ${line(task.id)} · ${parts.join(' · ')}] $ ${line(task.command)}`,
    ...formatCompletionContext(notice.context),
    ...(body
      ? [
          `${fence} ${TASK_FINISHED_NOTICE_TEXT.outputOpening} ${fence}`,
          body,
          `${fence} ${TASK_FINISHED_NOTICE_TEXT.outputClosing} ${fence}`,
        ]
      : []),
  ].join('\n');
}

/** Reuses individual bodies without nesting trusted envelopes around agent-authored data. */
function formatTasksFinished(notice: Extract<HarnessNotice, { kind: 'tasks-finished' }>): string {
  const reason = escapeTags(notice.reason);
  const fence = fenceDashes(reason);
  const bodies = notice.notices.map((individual) => {
    if (individual.kind === 'agent-report') return formatAgentReport(individual);

    return formatTaskFinished(individual);
  });

  return [
    TASKS_FINISHED_NOTICE_TEXT.opening,
    TASKS_FINISHED_NOTICE_TEXT.origin,
    TASKS_FINISHED_NOTICE_TEXT.reasonOrigin,
    `${fence} ${TASKS_FINISHED_NOTICE_TEXT.reasonOpening} ${fence}`,
    reason,
    `${fence} ${TASKS_FINISHED_NOTICE_TEXT.reasonClosing} ${fence}`,
    ...formatCompletionMetrics(notice.context),
    ...bodies,
    TASKS_FINISHED_NOTICE_TEXT.closing,
  ].join('\n');
}

/** Keep the calling agent's reason fenced separately from trusted completion measurements. */
function formatCompletionContext(context: TaskCompletionContext | undefined): string[] {
  if (!context) return [];

  const reason = escapeTags(context.reason);
  const fence = fenceDashes(reason);

  return [
    ...formatCompletionMetrics(context),
    TASK_COMPLETION_CONTEXT_TEXT.reasonOrigin,
    `${fence} ${TASK_COMPLETION_CONTEXT_TEXT.reasonOpening} ${fence}`,
    reason,
    `${fence} ${TASK_COMPLETION_CONTEXT_TEXT.reasonClosing} ${fence}`,
  ];
}

function formatCompletionMetrics(context: TaskCompletionContext | undefined): string[] {
  if (!context) return [];

  const parts = [
    `startedAt ${String(context.startedAt)} (epoch milliseconds)`,
    `duration ${String(context.durationMs)}ms`,
    `user messages since start ${String(context.userMessagesSinceStart)}`,
  ];

  if (context.callId !== undefined) {
    parts.push(`starting tool call ID ${line(context.callId)}`);
  }

  return [`Completion context: ${parts.join(' · ')}`];
}

function contextDescription(
  context: Extract<HarnessNotice, { kind: 'context-usage' }>['context'],
): string {
  const { window, used } = context;

  if (window !== undefined && used !== undefined) {
    const percent = Math.round((used / window) * 100);

    return `Context: ${count.format(used)} of ${count.format(window)} tokens used (${String(percent)}%)`;
  }

  if (window !== undefined) return `Context: ${count.format(window)} token window`;

  return `Context: ${count.format(used)} tokens used`;
}
