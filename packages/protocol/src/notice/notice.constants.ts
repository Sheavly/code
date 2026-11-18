import type { HarnessNotice, NoticeLifetime } from './notice.types.js';

/**
 * The lifetime of every notice kind, the one place the formatter, history, the loop and the
 * stream read it from. Adding a kind to `harnessNoticeSchema` fails typecheck until it has an
 * entry here, and a test checks each entry against the schemas.
 */
export const NOTICE_LIFETIMES: Record<HarnessNotice['kind'], NoticeLifetime> = {
  'running-tasks': 'transient',
  'context-usage': 'transient',
  'output-continuation': 'transient',
  'agent-report': 'persistent',
  'task-finished': 'persistent',
  'tasks-finished': 'persistent',
  'hook-failed': 'persistent',
  'extension-notice': 'persistent',
};

/** Maximum entries in one transient running-task snapshot. */
export const MAX_RUNNING_TASKS = 10;

/** Maximum title length in a transient running-task snapshot. */
export const MAX_RUNNING_TASK_TITLE_CHARS = 200;

/** Maximum length of the error text a `hook-failed` notice carries. */
export const MAX_HOOK_FAILED_ERROR_CHARS = 1000;

/** Maximum agent-authored reason length in a transient running-task snapshot. */
export const MAX_RUNNING_TASK_REASON_CHARS = 1000;
