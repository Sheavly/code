export const taskStatusPrompts = {
  description:
    "Show background tasks. With an id: that task's status and recent output, or, for a sub-agent, its complete report. Without: all tasks. " +
    'Inspection only, for requested updates or diagnosis, not a wait tool. Do not poll: finished tasks are reported automatically (grouped results arrive together). ' +
    'Finish independent work, then end your turn without tool calls to wait for required task results.',
  id: 'Task id, e.g. t1. Omit to list all tasks.',
};

export const cancelTaskPrompts = {
  description: 'Stop a running background task (kills its process and everything it started).',
  id: 'Task id, e.g. t1',
};

/** Receives an already formatted factual snapshot; only running snapshots need guidance. */
export function taskStatusResponse(params: { content: string; running: boolean }): string {
  const { content, running } = params;

  if (!running) return content;

  return (
    content +
    '\nSnapshot only; inspect for requested updates or diagnosis, not waiting. Do not poll. Grouped results arrive together when all members finish. Finish independent work, then end your turn without tool calls to wait for required task results. Services do not need to exit before you finish.'
  );
}
