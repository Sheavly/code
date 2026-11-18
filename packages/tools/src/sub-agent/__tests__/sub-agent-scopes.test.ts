import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { SessionRef } from '@sheavly/protocol/session/session.types';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import type { ChildSessionScope } from '@sheavly/runtime/sessions/session-scope.types';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { controlOf } from '../../tasks/task-control.utils.js';
import { createMessageAgentTool } from '../message-agent.tool.js';
import { createReportStatusTool } from '../report-status.tool.js';
import { createSubAgentTool } from '../sub-agent.tool.js';
import type { SubAgentScopes } from '../sub-agent.types.js';

const provider: Provider = {
  async *stream() {
    yield { type: 'done', stopReason: 'end_turn' };
  },
};
let tasks: TaskRegistry;

afterEach(async () => {
  await tasks.cancelAll();
});

/** Scopes over real registries whose `runChild` is the given function: the extension's view of a run. */
function scopesOver(params: {
  sessions: SessionRegistry;
  runChild: ChildSessionScope['runChild'];
}) {
  const { sessions, runChild } = params;
  const startChild = vi.fn<ChildSessionScope['startChild']>((call) => sessions.startChild(call));
  const scopes: SubAgentScopes = {
    sessions,
    tasks,
    taskControl: controlOf(tasks),
    children: {
      startChild,
      setModel: (call) => sessions.setModel(call),
      send: (call) => sessions.send(call),
      report: (call) => sessions.report(call),
      onUpdate: (listener) => sessions.subscribe(listener),
      runChild,
    },
  };

  return { scopes, startChild };
}

/** Starts a sub-agent through `scopes` from `parent` and waits for its task to settle. */
async function startThrough(params: { scopes: SubAgentScopes; parent: SessionRef }) {
  const result = await runTool({
    tools: [createSubAgentTool({ scopes: params.scopes, provider, tools: [] })],
    call: {
      id: callIdSchema.parse('child'),
      name: 'start_agent',
      input: { description: 'd', title: 'Review', task: 'Review the patch.' },
    },
    signal: new AbortController().signal,
    session: params.parent,
  });

  await tasks.nextSettled();

  return result;
}

/** A `runChild` whose sub-agent finishes at once with `reply` as its final answer. */
const completing = (reply: string) =>
  vi.fn<ChildSessionScope['runChild']>(async ({ messages }) => ({
    reason: 'completed',
    messages: [...messages, { role: 'assistant', content: reply, toolCalls: [] }],
  }));

describe('start_agent through scopes', () => {
  it('starts the child, the task and the run through the scopes, handing the run only the child', async () => {
    tasks = new TaskRegistry();
    const sessions = new SessionRegistry();
    const parent = sessions.startMain({ title: 'Main' });
    const runChild = completing('all done');
    const { scopes, startChild } = scopesOver({ sessions, runChild });
    const start = vi.spyOn(scopes.tasks, 'start');
    const result = await startThrough({ scopes, parent });
    const call = runChild.mock.calls[0]![0];

    expect(result.isError).toBe(false);
    expect(startChild).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
    expect(call.child.id).toBe(sessions.children(parent.id)[0]?.id);
    expect(Object.keys(call)).not.toContain('tasks');
    expect(Object.keys(call)).not.toContain('session');
    expect(tasks.report(taskIdSchema.parse('t1'))).toBe('all done');
  });

  it('gives the child report_status, the task tools, start_agent and message_agent below the cap', async () => {
    tasks = new TaskRegistry();
    const sessions = new SessionRegistry();
    const parent = sessions.startMain({ title: 'Main' });
    const runChild = completing('ok');

    await startThrough({ ...scopesOver({ sessions, runChild }), parent });

    expect(runChild.mock.calls[0]![0].tools.map((tool) => tool.name)).toEqual([
      'report_status',
      'task_status',
      'cancel_task',
      'await_tasks',
      'start_agent',
      'message_agent',
    ]);
  });

  it('stops listening to the child when its run ends, before anything the end produces', async () => {
    tasks = new TaskRegistry();
    const sessions = new SessionRegistry();
    const parent = sessions.startMain({ title: 'Main' });
    const runChild = vi.fn<ChildSessionScope['runChild']>(async (params) => {
      sessions.report({ id: params.child.id, status: 'during' });
      params.onRunEnd?.();
      // What cancelling the child's tasks produces: after the run, so not for the tool's output.
      sessions.report({ id: params.child.id, status: 'while cancelling' });

      return { reason: 'completed', messages: params.messages };
    });

    await startThrough({ ...scopesOver({ sessions, runChild }), parent });

    const output = tasks.get(taskIdSchema.parse('t1'))?.output ?? '';

    expect(output).toContain('[status] during');
    expect(output).not.toContain('while cancelling');
  });

  it('fails the task with the reason when the run did not complete', async () => {
    tasks = new TaskRegistry();
    const sessions = new SessionRegistry();
    const parent = sessions.startMain({ title: 'Main' });
    const runChild = vi.fn<ChildSessionScope['runChild']>(async () => ({
      reason: 'interrupted',
      messages: [],
    }));

    await startThrough({ ...scopesOver({ sessions, runChild }), parent });

    expect(tasks.get(taskIdSchema.parse('t1'))?.status).toBe('failed');
  });
});

describe('the sub-agent tools over scope picks', () => {
  it('reports status through a children scope that only reports', async () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Main' });
    const report = vi.fn((call: { id: string; status: string }) => call);
    const tool = createReportStatusTool({ children: { report } });

    await runTool({
      tools: [tool],
      call: {
        id: callIdSchema.parse('c1'),
        name: 'report_status',
        input: { description: 'd', status: 'working' },
      },
      signal: new AbortController().signal,
      session: main,
    });

    expect(report).toHaveBeenCalledWith({ id: main.id, status: 'working' });
  });

  it('messages through a children scope that only sends, looking the target up in the info view', async () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Main' });
    const child = sessions.startChild({
      parentId: main.id,
      startedByCall: callIdSchema.parse('c1'),
      title: 'Child',
    });
    const send = vi.fn((call: { id: string; content: string; from: string }) => call);
    const tool = createMessageAgentTool({
      sessions: { get: (id) => sessions.get(id), isReleased: (id) => sessions.isReleased(id) },
      children: { send },
    });
    const result = await runTool({
      tools: [tool],
      call: {
        id: callIdSchema.parse('c2'),
        name: 'message_agent',
        input: { description: 'd', session: child.id, message: 'hello' },
      },
      signal: new AbortController().signal,
      session: main,
    });

    expect(result.content).toContain('Sent to sub-agent "Child"');
    expect(send).toHaveBeenCalledWith({ id: child.id, content: 'hello', from: main.id });
  });
});
