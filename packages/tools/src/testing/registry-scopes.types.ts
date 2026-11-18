import type { RunChildParams, RunChildResult } from '@sheavly/runtime/sessions/session-scope.types';
import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { RunSession } from '@sheavly/runtime/sessions/sessions.types';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';

/**
 * The loop's runner as a test over whole registries hands it: a scope's `runChild` parameters plus
 * the registries `runChild` itself holds, so `runSession` fits.
 */
export type RunWithRegistries = (
  options: RunChildParams & { tasks: TaskRegistry; session: RunSession },
) => Promise<RunChildResult>;

/** What `registryScopes` builds scopes over. */
export type RegistryScopesOptions = {
  sessions: SessionRegistry;
  tasks: TaskRegistry;
  runAgent: RunWithRegistries;
};
