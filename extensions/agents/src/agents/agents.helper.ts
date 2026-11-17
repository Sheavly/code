import type { Extension } from '@sheavly/extension/extension/extension.types';
import { defineExtension } from '@sheavly/extension/extension/extension.utils';
import {
  INSTRUCTIONS,
  OUTPUTS,
  PROVIDER,
  SESSIONS,
  TASKS,
} from '@sheavly/host/run-services/run-services.utils';
import { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { createHistoryTools } from '@sheavly/tools/history/history.tool';
import { createMessageAgentTool } from '@sheavly/tools/sub-agent/message-agent.tool';
import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';
import { createOutputTools } from '@sheavly/tools/output/output.tool';
import { createTaskTools } from '@sheavly/tools/tasks/tasks.tool';
import type { AgentsExtensionOptions } from './agents.types.js';
import { createSubAgentScope, SUB_AGENTS } from './agents.utils.js';

/**
 * The extension for sub-agents and the background work around them: the task tools, `read_output`
 * and `search_output` (when the host supplies `OUTPUTS`), `start_agent` with `message_agent`, and
 * the history tools (with `logOf`). Generic: nothing here knows about files or commands.
 *
 * It reads the run's sessions, tasks, provider, instructions and outputs from the host's run
 * services in `activate`, so the host must supply them (`runServices`).
 *
 * It provides `SUB_AGENTS`. An extension that depends on it shares the tools and hooks
 * sub-agents get with `share`: the sub-agent tool is built here with no tools of its own, so what
 * a sub-agent can do is decided by the extensions of the run, not by this one.
 */
export function createAgentsExtension(options: AgentsExtensionOptions = {}): Extension {
  const { logOf } = options;

  return defineExtension({
    name: 'agents',
    activate: ({ services }) => {
      const sessions = services.get(SESSIONS);
      const tasks = services.get(TASKS);
      const provider = services.get(PROVIDER);
      const baseInstructions = services.get(INSTRUCTIONS);
      const outputs = services.find(OUTPUTS);
      const scope = createSubAgentScope();

      services.provide(SUB_AGENTS, scope);

      // The output tools go to sub-agents too, ahead of the tools other extensions share.
      const outputTools = outputs ? createOutputTools(outputs) : [];

      scope.share({ tools: outputTools });

      return {
        tools: [
          ...outputTools,
          ...createTaskTools(tasks),
          createSubAgentTool({
            sessions,
            tasks,
            provider,
            baseInstructions,
            ...(options.subAgentProvider && { selectProvider: options.subAgentProvider }),
            ...(options.summarizeWith && { summarizeWith: options.summarizeWith }),
            ...(options.keepAgentHistory && { keepHistory: options.keepAgentHistory }),
            runAgent: runSession,
            tools: scope.tools,
            // Read per sub-agent: an extension that activates later still adds its commands.
            get withTaskTools() {
              return scope.taskTools.length > 0;
            },
            hooks: scope.hooks,
          }),
          createMessageAgentTool({ sessions }),
          // Only a kept conversation has logs to search.
          ...(logOf ? createHistoryTools({ sessions, logOf }) : []),
        ],
      };
    },
  });
}
