import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { MAX_SESSION_DEPTH } from '@sheavly/runtime/sessions/sessions.constants';
import { startWork } from '@sheavly/runtime/tasks/work.utils';
import { subAgentWork } from './sub-agent-work.utils.js';
import { runSubAgent } from './sub-agent-run.helper.js';
import { createTaskTools } from '../tasks/tasks.tool.js';
import { createReportStatusTool } from './report-status.tool.js';
import { createMessageAgentTool } from './message-agent.tool.js';
import { subAgentDescription, subAgentPrompts, startedSubAgentPrompt } from './sub-agent.prompt.js';
import type { SubAgentOptions } from './sub-agent.types.js';
import type { SessionRef } from '@sheavly/protocol/session/session.types';

/** The tools a sub-agent at `child`'s depth gets: the parent's, `report_status`, and what its depth allows. */
function toolsFor(params: { options: SubAgentOptions; child: SessionRef }) {
  const { options, child } = params;
  const { children, sessions, taskControl } = options.scopes;
  const canNest = child.depth < MAX_SESSION_DEPTH;

  return [
    ...options.tools,
    createReportStatusTool({ children }),
    // Background-capable tools need inspection, grouping and cancellation even at the depth cap.
    ...(canNest || options.withTaskTools ? createTaskTools(taskControl) : []),
    ...(canNest
      ? [createSubAgentTool(options), createMessageAgentTool({ sessions, children })]
      : []),
  ];
}

/**
 * `start_agent`: starts a sub-agent, a nested agent loop on one task, as a background task of
 * the calling session. The sub-agent gets its own session (id, linked to the caller as parent),
 * its own `sessionStart`, the tools and hooks the parent chose, and `report_status`. Below the
 * depth cap it can start sub-agents of its own; at the cap (depth 3) it can't, and the session
 * registry refuses anyway. Its report, its final answer whole, comes back as the task's report.
 */
export function createSubAgentTool(options: SubAgentOptions) {
  const wiring = options.scopes;

  return defineTool({
    name: 'start_agent',
    description: subAgentDescription(MAX_SESSION_DEPTH),
    inputSchema: z.object({
      title: z.string().min(1).max(80).describe(subAgentPrompts.title),
      task: z.string().min(1).describe(subAgentPrompts.task),
    }),
    execute: async ({ input: { title, task }, context }) => {
      if (!context.session) {
        throw new ToolCallError({
          reason: 'unavailable',
          message: 'start_agent only works inside an agent session',
        });
      }

      // Throws for an unknown or ended parent, and at the depth cap: no session floats free.
      const child = wiring.children.startChild({
        parentId: context.session.id,
        startedByCall: context.callId,
        title,
      });
      const selected = options.selectProvider?.() ?? { provider: options.provider };

      if (selected.selection) {
        wiring.children.setModel({ id: child.id, ...selected.selection });
      }

      const childOptions = {
        ...options,
        provider: selected.provider,
        selectProvider: () => selected,
      };
      const started = startWork({
        tasks: wiring.tasks,
        work: subAgentWork({
          command: `sub-agent: ${title}`,
          description: context.description,
          callId: context.callId,
          sessionId: context.session.id,
          // The tools are built when the run starts, so a list or a flag that fills in after this
          // is built still applies.
          run: ({ signal, onOutput }) =>
            runSubAgent({
              options: childOptions,
              child,
              task,
              tools: toolsFor({ options: childOptions, child }),
              signal,
              onOutput,
            }),
        }),
      });

      return startedSubAgentPrompt({
        title,
        taskId: started.id,
        sessionId: child.id,
        depth: child.depth,
      });
    },
  });
}
