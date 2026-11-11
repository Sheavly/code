import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import type { RunNestedAgent } from '../sub-agent.types.js';
import { createSubAgentTool } from '../sub-agent.tool.js';

let tasks: TaskRegistry;

afterEach(async () => {
  await tasks.cancelAll();
});

describe('start_agent task lifecycle', () => {
  it('starts finite work by default and gives the child all task tools', async () => {
    tasks = new TaskRegistry();
    const sessions = new SessionRegistry();
    const parent = sessions.startMain({ title: 'Main' });
    const finish = Promise.withResolvers<Awaited<ReturnType<RunNestedAgent>>>();
    const runAgent = vi.fn<RunNestedAgent>(({ signal }) => {
      signal.addEventListener('abort', () =>
        finish.resolve({ reason: 'interrupted', messages: [] }),
      );

      return finish.promise;
    });
    const provider: Provider = {
      async *stream() {
        yield { type: 'done', stopReason: 'end_turn' };
      },
    };
    const start = vi.spyOn(tasks, 'start');
    const result = await runTool({
      tools: [createSubAgentTool({ sessions, tasks, provider, runAgent, tools: [] })],
      call: {
        id: callIdSchema.parse('child'),
        name: 'start_agent',
        input: { description: 'Review the patch', title: 'Review', task: 'Review the patch.' },
      },
      signal: new AbortController().signal,
      session: parent,
    });

    expect(result.isError).toBe(false);
    const child = runAgent.mock.calls[0]![0].session.ref;

    expect(result.content).toBe(
      `Started sub-agent "Review" as background task t1 (session ${child.id}, depth ${child.depth}). Its complete report comes to you automatically: ` +
        "don't poll task_status for it; once you have nothing else to do, end your turn and wait. " +
        'Use message_agent with its session id to steer it, cancel_task to stop it.',
    );
    expect(tasks.hasPendingTasks(parent.id)).toBe(true);
    expect(start.mock.calls[0]?.[0]).toMatchObject({ sessionId: parent.id });
    const childOptions = runAgent.mock.calls[0]![0];

    expect(childOptions.tools.map((tool) => tool.name)).toEqual([
      'report_status',
      'task_status',
      'cancel_task',
      'await_tasks',
      'start_agent',
      'message_agent',
    ]);
    expect(Object.keys(childOptions).sort()).toEqual([
      'hooks',
      'instructions',
      'messages',
      'provider',
      'session',
      'signal',
      'tasks',
      'tools',
    ]);
    finish.resolve({ reason: 'completed', messages: [] });
    await tasks.nextSettled();
    expect(tasks.get(taskIdSchema.parse('t1'))?.status).toBe('completed');
    expect(tasks.takeDeliveries(parent.id)).toHaveLength(1);
    expect(tasks.hasPendingTasks(parent.id)).toBe(false);
  });
});
