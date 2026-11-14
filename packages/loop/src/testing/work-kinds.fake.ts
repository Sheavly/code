import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { startTaskTool } from '@sheavly/runtime/testing/start-task.fake';
import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';
import { runSession } from '../stream-agent/stream-agent.helper.js';
import type { WorkEnv, WorkKind } from './work-kinds.types.js';

const SLOW_MS = 60_000;
const QUICK_MS = 5;

/** A model turn that makes one tool call and stops for its result. */
export function toolTurn(params: {
  id: string;
  name: string;
  input: Record<string, unknown>;
}): StreamEvent[] {
  const { id, name, input } = params;

  return [
    {
      type: 'tool_call',
      call: { id: callIdSchema.parse(id), name, input: { description: `${name} ${id}`, ...input } },
    },
    { type: 'done', stopReason: 'tool_use' },
  ];
}

/** A model turn that answers in text and ends. */
export function say(text: string): StreamEvent[] {
  return [
    { type: 'text_delta', text },
    { type: 'done', stopReason: 'end_turn' },
  ];
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

const foregroundTool = defineTool({
  name: 'foreground_work',
  description: 'Work the model waits for',
  inputSchema: z.object({ speed: z.enum(['quick', 'slow', 'failing']) }),
  execute: async ({ input: { speed }, signal }) => {
    if (speed === 'slow') await waitForAbort(signal);

    if (speed === 'failing') throw new Error('foreground work failed');

    return 'foreground done';
  },
});

/** What the sub-agent's own model does, chosen by the task text the parent wrote. */
const childProvider: Provider = {
  async *stream({ messages, signal }) {
    const task = JSON.stringify(messages[0]);

    if (task.includes('slow')) await waitForAbort(signal);

    if (task.includes('failing')) throw new Error('sub-agent model failed');

    yield* say('child report');
  },
};

function subAgentTool({ tasks, sessions }: WorkEnv): Tool {
  return createSubAgentTool({
    sessions,
    tasks,
    provider: childProvider,
    runAgent: (options) => runSession(options),
    tools: [],
  });
}

export const WORK_KINDS: WorkKind[] = [
  {
    name: 'foreground tool',
    background: false,
    finite: true,
    tools: () => [foregroundTool],
    start: ({ speed, id }) => toolTurn({ id, name: 'foreground_work', input: { speed } }),
  },
  ...(['task', 'service'] as const).map((backgroundKind): WorkKind => ({
    name: `background command (${backgroundKind})`,
    background: true,
    finite: backgroundKind === 'task',
    tools: ({ tasks }) => [startTaskTool(tasks)],
    start: ({ speed, id }) =>
      toolTurn({
        id,
        name: 'start_task',
        input: {
          ms: speed === 'slow' ? SLOW_MS : QUICK_MS,
          output: 'finished output',
          exitCode: speed === 'failing' ? 1 : 0,
          backgroundKind,
        },
      }),
  })),
  {
    name: 'sub-agent',
    background: true,
    finite: true,
    tools: (env) => [subAgentTool(env)],
    start: ({ speed, id }) =>
      toolTurn({ id, name: 'start_agent', input: { title: `Agent ${id}`, task: `${speed} job` } }),
  },
];
