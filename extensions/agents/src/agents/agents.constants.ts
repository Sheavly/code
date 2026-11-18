/**
 * The tools every sub-agent gets from the `agents` extension itself, whatever is shared: another
 * extension cannot share a tool under one of these names.
 */
export const OWN_SUB_AGENT_TOOLS: readonly string[] = [
  'report_status',
  'task_status',
  'cancel_task',
  'await_tasks',
  'start_agent',
  'message_agent',
];
