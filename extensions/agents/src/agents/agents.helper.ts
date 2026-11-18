import type { Extension } from '@sheavly/extension/extension/extension.types';
import { defineExtension } from '@sheavly/extension/extension/extension.utils';
import { readManifest } from '@sheavly/extension/manifest/manifest.helper';
import {
  BACKGROUND_TASKS,
  CHILD_SESSIONS,
  INSTRUCTIONS,
  MODEL,
  OUTPUT_READER,
  SESSION_INFO,
  TASK_CONTROL,
} from '@sheavly/host/run-services/run-services.utils';
import { createHistoryTools } from '@sheavly/tools/history/history.tool';
import { createMessageAgentTool } from '@sheavly/tools/sub-agent/message-agent.tool';
import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';
import { createOutputTools } from '@sheavly/tools/output/output.tool';
import { createTaskTools } from '@sheavly/tools/tasks/tasks.tool';
import type { AgentsExtensionOptions } from './agents.types.js';
import { createSubAgentScope, SUB_AGENTS } from './agents.utils.js';

// src/agents/ and dist/agents/ are both two levels below the workspace root.
const manifest = readManifest(new URL('../../sheavly.json', import.meta.url));

/**
 * The extension for sub-agents and the background work around them: the task tools, `read_output`
 * and `search_output` (when the host supplies `OUTPUT_READER`), `start_agent` with
 * `message_agent`, and the history tools (with `logOf`). Generic: nothing here knows about files
 * or commands.
 *
 * It reads the run's scoped services from the host in `activate` (session info, child sessions,
 * background tasks, task control, the model, the instructions and the output reader), so the host
 * must supply them (`runServices`) and its `sheavly.json` must declare the grants it uses. It
 * holds no registry and does not import the loop: `child-sessions` runs a sub-agent's loop.
 *
 * It provides `SUB_AGENTS`. An extension that depends on it shares the tools and hooks
 * sub-agents get with `share`: the sub-agent tool is built here with no tools of its own, so what
 * a sub-agent can do is decided by the extensions of the run, not by this one.
 */
export function createAgentsExtension(options: AgentsExtensionOptions = {}): Extension {
  const { logOf } = options;

  return defineExtension({
    manifest,
    activate: ({ services }) => {
      const sessions = services.get(SESSION_INFO);
      const children = services.get(CHILD_SESSIONS);
      const tasks = services.get(BACKGROUND_TASKS);
      const taskControl = services.get(TASK_CONTROL);
      const provider = services.get(MODEL);
      const baseInstructions = services.get(INSTRUCTIONS);
      const outputs = services.find(OUTPUT_READER);
      // Only `scope.share` is provided: the lists stay in this closure, read by `start_agent` alone.
      const { scope, shared } = createSubAgentScope();

      services.provide(SUB_AGENTS, scope);

      // The output tools go to sub-agents too, ahead of the tools other extensions share.
      const outputTools = outputs ? createOutputTools(outputs) : [];

      scope.share({ tools: outputTools });

      return {
        tools: [
          ...outputTools,
          ...createTaskTools(taskControl),
          createSubAgentTool({
            scopes: { sessions, children, tasks, taskControl },
            provider,
            baseInstructions,
            ...(options.subAgentProvider && { selectProvider: options.subAgentProvider }),
            ...(options.summarizeWith && { summarizeWith: options.summarizeWith }),
            ...(options.keepAgentHistory && { keepHistory: options.keepAgentHistory }),
            tools: shared.tools,
            // Read per sub-agent: an extension that activates later still adds its commands.
            get withTaskTools() {
              return shared.taskTools.length > 0;
            },
            hooks: shared.hooks,
          }),
          createMessageAgentTool({ sessions, children }),
          // Only a kept conversation has logs to search.
          ...(logOf ? createHistoryTools({ sessions, logOf }) : []),
        ],
      };
    },
  });
}
