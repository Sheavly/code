import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';
import { escapeTags, fenceDashes, oneLine } from '../text/text.utils.js';
import {
  AGENT_REPORT_NOTICE_TEXT,
  CONTEXT_USAGE_NOTICE_TEXT,
  OUTPUT_CONTINUATION_NOTICE_TEXT,
  TASK_FINISHED_NOTICE_TEXT,
  TASKS_FINISHED_NOTICE_TEXT,
} from './notice.constants.js';

const count = new Intl.NumberFormat('en-US');

/** Formats trusted harness data with its origin and handling policy, never as a user request. */
export function formatHarnessNotice(notice: HarnessNotice): string {
  switch (notice.kind) {
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
    ...bodies,
    TASKS_FINISHED_NOTICE_TEXT.closing,
  ].join('\n');
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
