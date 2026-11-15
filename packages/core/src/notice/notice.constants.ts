/** Trusted envelope markup stays with the formatter, separate from model handling policy. */
export const CONTEXT_USAGE_NOTICE_TEXT = {
  opening: '<harness-notice kind="context-usage">',
  closing: '</harness-notice>',
} as const;

export const AGENT_REPORT_NOTICE_TEXT = {
  opening: '<harness-notice kind="agent-report">',
  reportOpening: 'report',
  reportClosing: 'end of report',
  closing: '</harness-notice>',
} as const;

export const TASK_FINISHED_NOTICE_TEXT = {
  opening: '<harness-notice kind="task-finished">',
  outputOpening: 'output (a bounded preview)',
  outputClosing: 'end of output',
  closing: '</harness-notice>',
} as const;

export const TASKS_FINISHED_NOTICE_TEXT = {
  opening: '<harness-notice kind="tasks-finished">',
  reasonOpening: 'agent-authored wait reason',
  reasonClosing: 'end of wait reason',
  closing: '</harness-notice>',
} as const;

export const HOOK_FAILED_NOTICE_TEXT = {
  opening: '<harness-notice kind="hook-failed">',
  errorOpening: 'hook error',
  errorClosing: 'end of hook error',
  closing: '</harness-notice>',
} as const;

export const TASK_COMPLETION_CONTEXT_TEXT = {
  reasonOpening: 'agent-authored completion reason',
  reasonClosing: 'end of completion reason',
} as const;

export const RUNNING_TASKS_NOTICE_TEXT = {
  opening: '<harness-notice kind="running-tasks">',
  reasonOpening: 'agent-authored running-task reason',
  reasonClosing: 'end of running-task reason',
  closing: '</harness-notice>',
} as const;

export const OUTPUT_CONTINUATION_NOTICE_TEXT = {
  opening: '<harness-notice kind="output-continuation">',
  closing: '</harness-notice>',
} as const;
