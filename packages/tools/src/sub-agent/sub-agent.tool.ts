import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { MAX_SESSION_DEPTH } from '@sheavly/runtime/sessions/sessions.constants';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { createTaskTools } from '../tasks/tasks.tool.js';
import { createReportStatusTool } from './report-status.tool.js';
import { createMessageAgentTool } from './message-agent.tool.js';
import { SUB_AGENT_INSTRUCTIONS } from './sub-agent.constants.js';
import type { SubAgentOptions } from './sub-agent.types.js';
import { finalReply, subAgentInstructions } from './sub-agent.utils.js';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import type { SessionRef } from '@sheavly/protocol/session/session.types';

/**
 * `start_agent`: starts a sub-agent, a nested agent loop on one task, as a background task of
 * the calling session. The sub-agent gets its own session (id, linked to the caller as parent),
 * its own `sessionStart`, the tools and hooks the parent chose, and `report_status`. Below the
 * depth cap it can start sub-agents of its own; at the cap (depth 3) it can't, and the session
 * registry refuses anyway. Its final reply comes back as the task's output.
 */
export function createSubAgentTool(options: SubAgentOptions) {
  const { sessions, tasks } = options;

  return defineTool({
    name: 'start_agent',
    description:
      'Start a sub-agent on a self-contained task. It runs in the background; its final reply ' +
      'comes to you automatically when it finishes. No need to poll: when you have nothing else ' +
      'to do, end your turn and you will be woken with the reply. Steer it with message_agent, ' +
      `stop it with cancel_task. Sub-agents nest at most ${MAX_SESSION_DEPTH} levels deep.`,
    inputSchema: z.object({
      title: z.string().min(1).max(80).describe('A short name, e.g. "Update ESLint rules"'),
      task: z
        .string()
        .min(1)
        .describe('Everything the sub-agent needs: it does not see your conversation'),
    }),
    execute: async ({ input: { title, task }, context }) => {
      if (!context.session) {
        throw new ToolCallError({
          reason: 'unavailable',
          message: 'start_agent only works inside an agent session',
        });
      }

      // Throws for an unknown or ended parent, and at the depth cap: no session floats free.
      const child = sessions.startChild({ parentId: context.session.id, title });
      const started = tasks.start({
        command: `sub-agent: ${title}`,
        description: context.description,
        callId: context.callId,
        run: ({ signal, onOutput }) => runChild({ options, child, task, signal, onOutput }),
      });

      return (
        `Started sub-agent "${title}" as background task ${started.id} ` +
        `(session ${child.id}, depth ${child.depth}). Its final reply comes to you automatically: ` +
        "don't poll task_status for it; once you have nothing else to do, end your turn and wait. " +
        'Use message_agent with its session id to steer it, cancel_task to stop it.'
      );
    },
  });
}

/** Runs the sub-agent's loop to its end. Its status reports also go into the task's output. */
async function runChild(params: {
  options: SubAgentOptions;
  child: SessionRef;
  task: string;
  signal: AbortSignal;
  onOutput: (chunk: string) => void;
}): Promise<{ exitCode: number }> {
  const { options, child, task, signal, onOutput } = params;
  const { sessions, provider, runAgent, tools, hooks = [], instructions, maxTurns } = options;
  // The sub-agent's own background tasks (its sub-agents); stopped when it ends.
  const childTasks = new TaskRegistry();
  const canNest = child.depth < MAX_SESSION_DEPTH;
  const stopListening = sessions.subscribe((update) => {
    if (update.session.id !== child.id) return;

    if (update.type === 'session_status') onOutput(`[status] ${update.session.status ?? ''}\n`);

    if (update.type === 'session_message') onOutput(`[message] ${update.message.content}\n`);
  });

  try {
    const { reason, messages } = await runAgent({
      provider,
      tools: [
        ...tools,
        createReportStatusTool({ sessions }),
        ...(canNest
          ? [
              createSubAgentTool({ ...options, tasks: childTasks }),
              createMessageAgentTool({ sessions }),
              ...createTaskTools(childTasks),
            ]
          : []),
      ],
      hooks,
      instructions: subAgentInstructions({ rules: SUB_AGENT_INSTRUCTIONS, extra: instructions }),
      messages: [{ role: 'user', content: task }],
      signal,
      tasks: childTasks,
      waitForTasks: true,
      session: { registry: sessions, ref: child },
      ...(maxTurns !== undefined && { maxTurns }),
    });

    onOutput(`\n${finalReply(messages)}`);

    return { exitCode: reason === 'completed' ? 0 : 1 };
  } finally {
    stopListening();
    await childTasks.cancelAll();
  }
}
