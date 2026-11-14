import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { messageIdSchema } from '@sheavly/protocol/message/message.validator';
import { now } from '@sheavly/core/clock/clock.helper';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { MAX_SESSION_DEPTH } from '@sheavly/runtime/sessions/sessions.constants';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { startWork } from '@sheavly/runtime/tasks/work.utils';
import { subAgentWork } from './sub-agent-work.utils.js';
import { SubAgentStoppedError } from '../errors/sub-agent.errors.js';
import { createTaskTools } from '../tasks/tasks.tool.js';
import { createReportStatusTool } from './report-status.tool.js';
import { createMessageAgentTool } from './message-agent.tool.js';
import {
  SUB_AGENT_INSTRUCTIONS,
  subAgentDescription,
  subAgentPrompts,
  startedSubAgentPrompt,
} from './sub-agent.prompt.js';
import type { SubAgentOptions } from './sub-agent.types.js';
import { finalReply, subAgentInstructions } from './sub-agent.utils.js';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { SessionRef } from '@sheavly/protocol/session/session.types';

/**
 * `start_agent`: starts a sub-agent, a nested agent loop on one task, as a background task of
 * the calling session. The sub-agent gets its own session (id, linked to the caller as parent),
 * its own `sessionStart`, the tools and hooks the parent chose, and `report_status`. Below the
 * depth cap it can start sub-agents of its own; at the cap (depth 3) it can't, and the session
 * registry refuses anyway. Its report, its final answer whole, comes back as the task's report.
 */
export function createSubAgentTool(options: SubAgentOptions) {
  const { sessions, tasks } = options;

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
      const child = sessions.startChild({
        parentId: context.session.id,
        startedByCall: context.callId,
        title,
      });
      const selected = options.selectProvider?.() ?? { provider: options.provider };

      if (selected.selection) sessions.setModel({ id: child.id, ...selected.selection });

      const childOptions = {
        ...options,
        provider: selected.provider,
        selectProvider: () => selected,
      };
      const started = startWork({
        tasks,
        work: subAgentWork({
          command: `sub-agent: ${title}`,
          description: context.description,
          callId: context.callId,
          sessionId: context.session.id,
          run: ({ signal, onOutput }) =>
            runChild({ options: childOptions, child, task, signal, onOutput }),
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

/**
 * Runs the sub-agent's loop to its end and returns its report, whole. Its status and steering
 * lines go into the task's output preview, never into the report.
 */
async function runChild(params: {
  options: SubAgentOptions;
  child: SessionRef;
  task: string;
  signal: AbortSignal;
  onOutput: (chunk: string) => void;
}): Promise<{ exitCode: number; report: string }> {
  const { options, child, task, signal, onOutput } = params;
  const { sessions, provider, runAgent, tools, hooks = [], instructions } = options;
  // The sub-agent's own background tasks (its sub-agents); stopped when it ends. They join the
  // combined stream like the main run's, so a UI sees a nested task start and end too.
  const childTasks = new TaskRegistry();
  const stopPublishing = childTasks.observe((update) => sessions.publishTask(update));
  const canNest = child.depth < MAX_SESSION_DEPTH;
  const summary = options.summarizeWith?.(provider);
  const stopListening = sessions.subscribe((update) => {
    if (update.session.id !== child.id) return;

    if (update.type === 'session_status') onOutput(`[status] ${update.session.status ?? ''}\n`);

    if (update.type === 'session_message') onOutput(`[message] ${update.message.content}\n`);
  });

  // An id marks the one message the sub-agent's own work is asked for: the agent that started
  // it wrote the task, and no one else can message a sub-agent as a user.
  const first: HistoryMessage[] = [
    { role: 'user', id: messageIdSchema.parse(randomUUID()), content: task, at: now() },
  ];

  // Kept before the run, so a crash mid-run does not lose what the agent was asked.
  options.keepHistory?.({ session: child.id, messages: first });

  try {
    const { reason, messages } = await runAgent({
      provider,
      tools: [
        ...tools,
        ...(options.tasksTools?.(childTasks) ?? []),
        createReportStatusTool({ sessions }),
        // Background-capable tools need inspection, grouping and cancellation even at the depth cap.
        ...(canNest || options.tasksTools ? createTaskTools(childTasks) : []),
        ...(canNest
          ? [
              createSubAgentTool({ ...options, tasks: childTasks }),
              createMessageAgentTool({ sessions }),
            ]
          : []),
      ],
      hooks,
      instructions: subAgentInstructions({
        base: options.baseInstructions,
        rules: SUB_AGENT_INSTRUCTIONS,
        extra: instructions,
      }),
      messages: first,
      ...(options.keepHistory && {
        keepHistory: (kept: readonly HistoryMessage[]) =>
          options.keepHistory?.({ session: child.id, messages: kept }),
      }),
      signal,
      tasks: childTasks,
      session: { registry: sessions, ref: child },
      ...(summary && { summary }),
    });

    // Kept whatever the reason: work a stopped run did stays in the record.
    options.keepHistory?.({ session: child.id, messages });

    // A run that did not finish has no report: its last message is work in progress. Throwing
    // fails the task with the reason, so the parent is told it failed and why, not handed text.
    if (reason !== 'completed') {
      throw new SubAgentStoppedError({ reason });
    }

    const report = finalReply(messages);

    // The preview keeps the report's end for a UI that shows a card; the parent is handed `report`.
    onOutput(`\n${report}`);

    return { exitCode: 0, report };
  } finally {
    stopListening();
    // Cancelled first, then unobserved: the stream still sees each cancelled task end.
    await childTasks.cancelAll();
    stopPublishing();
  }
}
