import { controlOf } from '../tasks/task-control.utils.js';
import type { SubAgentScopes } from '../sub-agent/sub-agent.types.js';
import type { RegistryScopesOptions } from './registry-scopes.types.js';

/**
 * Test-only: scopes straight over the run's whole registries, for the packages below `host`, which
 * cannot build the real ones. Nothing is owned or granted: every session and task is reachable.
 * `runChild` does what the host's does: keeps the history before and after the loop runs and stops
 * the child's tasks when it ends, however it ends.
 */
export function registryScopes(options: RegistryScopesOptions): SubAgentScopes {
  const { sessions, tasks, runAgent } = options;

  return {
    sessions,
    tasks,
    taskControl: controlOf(tasks),
    children: {
      startChild: (params) => sessions.startChild(params),
      setModel: (params) => sessions.setModel(params),
      send: (params) => sessions.send(params),
      report: (params) => sessions.report(params),
      onUpdate: (listener) => sessions.subscribe(listener),
      runChild: async (params) => {
        const { child, keepHistory, messages, onRunEnd } = params;

        keepHistory?.(messages);

        try {
          const result = await runAgent({
            ...params,
            tasks,
            session: { registry: sessions, ref: child },
          });

          keepHistory?.(result.messages);

          return result;
        } finally {
          onRunEnd?.();
          await tasks.cancelSession(child.id);
        }
      },
    },
  };
}
