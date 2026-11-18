import type { TaskControl } from '@sheavly/runtime/tasks/task-scope.types';
import type { TaskControlSource } from './tasks.types.js';

/**
 * The `TaskControl` view of `source`: a scope as it is, a registry through the calls the task
 * tools make. The registry's `cancel` has no session, so the view's `cancel` is only as scoped as
 * its caller's own `getOwned` check, as the tools make it.
 */
export function controlOf(source: TaskControlSource): TaskControl {
  if (!('cancelAll' in source)) return source;

  return {
    getOwned: (params) => source.getOwned(params),
    list: (sessionId) => source.list(sessionId),
    report: (id) => source.report(id),
    cancel: async ({ id }) => await source.cancel(id),
    group: (params) => source.group(params),
  };
}
