import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';
import { registryScopes } from '@sheavly/tools/testing/registry-scopes.fake';
import { runSession } from '../stream-agent.helper.js';
import { say, toolTurn } from '../../testing/work-kinds.fake.js';

const tasks = new TaskRegistry();

afterEach(() => tasks.cancelAll());

/** What a parent tool did when called: its calls, so a test can see the tool ran. */
function parentToolNamed(name: string, calls: string[] = []) {
  return defineTool({
    name,
    description: 'A parent tool that happens to share a name',
    inputSchema: z.object({}),
    execute: async () => {
      calls.push(name);

      return 'parent';
    },
  });
}

/**
 * Delegates to a sub-agent whose parent shares `parentTool`, as a child of a session at `depth`
 * (the child is one deeper). The sub-agent's model calls its own tool `callName` when given.
 */
async function delegate(params: { parentTool: Tool; parentDepth: 1 | 2; callName?: string }) {
  const { parentTool, parentDepth, callName } = params;
  const sessions = new SessionRegistry();
  const main = sessions.startMain({ title: 'Chat' });
  const ref =
    parentDepth === 1
      ? main
      : sessions.startChild({
          parentId: main.id,
          startedByCall: callIdSchema.parse('seed'),
          title: 'Middle',
        });
  const childCalls = { count: 0 };
  const childProvider: Provider = {
    async *stream() {
      childCalls.count += 1;
      yield* childCalls.count === 1 && callName
        ? toolTurn({ id: 'k1', name: callName, input: {} })
        : say('child report');
    },
  };
  const startAgent = createSubAgentTool({
    scopes: registryScopes({ sessions, tasks, runAgent: (options) => runSession(options) }),
    provider: childProvider,
    tools: [parentTool],
  });

  const { messages } = await runSession({
    provider: scriptedProvider([
      toolTurn({ id: 'c1', name: 'start_agent', input: { title: 'Child', task: 'work' } }),
      say('Started.'),
      say('Finished.'),
    ]),
    tools: [startAgent],
    tasks,
    messages: [{ role: 'user', content: 'delegate' }],
    session: { registry: sessions, ref },
    keepSession: true,
  });

  const finished = messages.find(
    (message) => message.role === 'notice' && message.notice.kind === 'task-finished',
  );

  return { childCalls, finished };
}

describe('a sub-agent run checks tool names like any run', () => {
  // The sub-agent of a main session is at depth 2, below the cap: it gets all of these.
  it.each([
    'report_status',
    'task_status',
    'cancel_task',
    'await_tasks',
    'start_agent',
    'message_agent',
  ])(
    'fails the sub-agent before its first model call when a parent tool is named %s',
    async (name) => {
      const { childCalls, finished } = await delegate({
        parentTool: parentToolNamed(name),
        parentDepth: 1,
      });

      // The parent is told the sub-agent started, then that its task failed with the loop's message.
      expect(finished).toMatchObject({
        notice: {
          kind: 'task-finished',
          task: {
            status: 'failed',
            error: `Tool ${name} is listed 2 times: tool names must be unique within a run`,
          },
        },
      });
      expect(childCalls.count).toBe(0);
    },
  );

  // At the depth cap (3) the sub-agent gets neither the task tools (without `withTaskTools`) nor
  // `start_agent` and `message_agent`, so a parent tool of that name is the only one.
  it.each(['task_status', 'start_agent', 'message_agent'])(
    'runs a parent tool named %s for a sub-agent at the depth cap, which does not add its own',
    async (name) => {
      const ran: string[] = [];
      const { childCalls, finished } = await delegate({
        parentTool: parentToolNamed(name, ran),
        parentDepth: 2,
        callName: name,
      });

      // A sub-agent that ends well reports back; only a failed one leaves a task-finished notice.
      expect(finished).toBeUndefined();
      expect(ran).toEqual([name]);
      expect(childCalls.count).toBe(2);
    },
  );
});
