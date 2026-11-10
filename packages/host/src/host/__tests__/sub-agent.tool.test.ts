import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';
import {
  calls,
  routedProvider,
  say,
  toolCall,
} from '@sheavly/testing/provider/routed-provider.fake';
import { startDeepestSession } from '@sheavly/runtime/testing/sessions.fake';
import type { Script } from '@sheavly/testing/provider/provider.types';
import type { SessionUpdate } from '@sheavly/protocol/session/session.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

const callId = callIdSchema.parse('c');

const call = (id: string, name: string, input: Record<string, unknown>) =>
  toolCall({ id, name, input });
const toolUse: StreamEvent = { type: 'done', stopReason: 'tool_use' };

/** A main session with `start_agent`, like a host would wire it. */
function setup(params: {
  scripts: Record<string, Script[]>;
  hooks?: Parameters<typeof createSubAgentTool>[0]['hooks'];
  runAgent?: Parameters<typeof createSubAgentTool>[0]['runAgent'];
}) {
  const sessions = new SessionRegistry();
  const tasks = new TaskRegistry();
  const updates: SessionUpdate[] = [];

  sessions.subscribe((update) => updates.push(update));

  const provider = routedProvider(params.scripts);
  const main = sessions.startMain({ title: 'Main' });
  const tool = createSubAgentTool({
    sessions,
    tasks,
    provider,
    runAgent: params.runAgent ?? runSession,
    tools: [],
    ...(params.hooks && { hooks: params.hooks }),
  });
  /** Runs the main session on `content` until its sub-agents finish. */
  const run = (content: string, hooks: Hook[] = []) =>
    runSession({
      provider,
      tools: [tool],
      hooks,
      messages: [{ role: 'user', content }],
      tasks,
      session: { registry: sessions, ref: main },
    });

  return { sessions, tasks, updates, provider, main, tool, run };
}

describe('start_agent', () => {
  it('runs a sub-agent in its own session linked to the parent, and returns its reply', async () => {
    const { sessions, main, run } = setup({
      scripts: {
        'Do the thing': [
          calls(call('m1', 'start_agent', { title: 'Helper', task: 'Help out' })),
          say('All done.'),
        ],
        'Help out': [
          calls(call('s1', 'report_status', { status: 'reading files, reading core package' })),
          say('Helped.'),
        ],
      },
    });

    const { reason, messages } = await run('Do the thing');

    const [helper] = sessions.children(main.id);

    expect(reason).toBe('completed');
    expect(helper).toMatchObject({
      title: 'Helper',
      parentId: main.id,
      // The call, in the main session's history, that started it: where a UI puts its card.
      startedByCall: 'm1',
      rootId: main.id,
      depth: 2,
      state: 'completed',
      status: 'reading files, reading core package',
    });
    expect(helper?.id).not.toBe(main.id);
    // The parent was told the sub-agent's final reply, through the task notification.
    expect(messages.some((m) => m.role === 'user' && m.content.includes('Helped.'))).toBe(true);
    expect(sessions.get(main.id)?.state).toBe('completed');
  });

  it('nests three levels deep, and refuses a fourth (no start_agent at depth 3)', async () => {
    const seenTools: Record<string, string[]> = {};
    const record =
      (task: string): Script =>
      (request) => {
        seenTools[task] = request.tools.map((t) => t.name).sort();

        return [];
      };
    const { sessions, run } = setup({
      scripts: {
        Main: [calls(call('a', 'start_agent', { title: 'Level 2', task: 'L2' })), say('main done')],
        L2: [
          (r) => [
            ...record('L2')(r),
            call('b', 'start_agent', { title: 'Level 3', task: 'L3' }),
            toolUse,
          ],
          say('l2 done'),
        ],
        L3: [
          (r) => [
            ...record('L3')(r),
            { type: 'text_delta', text: 'l3 done' },
            { type: 'done', stopReason: 'end_turn' },
          ],
        ],
      },
    });

    await run('Main');

    const levels = sessions.list().map((s) => [s.title, s.depth, s.state]);

    expect(levels).toEqual([
      ['Main', 1, 'completed'],
      ['Level 2', 2, 'completed'],
      ['Level 3', 3, 'completed'],
    ]);
    expect(seenTools.L2).toContain('start_agent');
    expect(seenTools.L3).toEqual(['report_status']); // depth 3: cannot start sub-agents
    const [level3] = sessions.list().filter((s) => s.depth === 3);

    if (!level3) throw new Error('No session reached depth 3');
    expect(sessions.lineage(level3.id).map((s) => s.title)).toEqual(['Level 3', 'Level 2', 'Main']);
  });

  it('refuses start_agent called by a session at the depth cap', async () => {
    const sessions = new SessionRegistry();
    const tasks = new TaskRegistry();
    const three = startDeepestSession(sessions);
    const tool = createSubAgentTool({
      sessions,
      tasks,
      provider: routedProvider({}),
      runAgent: runSession,
      tools: [],
    });

    await expect(
      tool.execute({
        input: { title: 'Level 4', task: 'too deep' },
        signal: new AbortController().signal,
        context: { callId, description: 'd', session: three },
      }),
    ).rejects.toThrow('Sub-agents nest at most 3 levels');
    expect(sessions.list()).toHaveLength(3);
    expect(tasks.list()).toHaveLength(0);
  });

  it('streams status reports live, in order, from the sub-agent itself', async () => {
    const { sessions, tasks, updates, main, run } = setup({
      scripts: {
        Main: [calls(call('m', 'start_agent', { title: 'Worker', task: 'Work' })), say('ok')],
        Work: [
          calls(call('1', 'report_status', { status: 'reading files, reading core package' })),
          calls(call('2', 'report_status', { status: 'editing core package' })),
          calls(call('3', 'report_status', { status: 'updating ESLint rules' })),
          say('done'),
        ],
      },
    });

    await run('Main');

    const worker = sessions.children(main.id)[0];
    const statuses = updates
      .filter((u) => u.type === 'session_status' && u.session.id === worker?.id)
      .map((u) => u.session.status);

    expect(statuses).toEqual([
      'reading files, reading core package',
      'editing core package',
      'updating ESLint rules',
    ]);
    // The parent can see them too, in the task's output.
    expect(tasks.list()[0]?.output).toContain('[status] editing core package');
  });

  it('gives sub-agents only the hooks the parent chose, each with its own sessionStart', async () => {
    const log: string[] = [];
    const parentOnly = defineHook({
      name: 'parent-only',
      sessionStart: async () => void log.push('parent-only'),
    });
    const forChildren = defineHook({
      name: 'for-children',
      sessionStart: async ({ addContext }) => {
        log.push('for-children');
        addContext('child rule');
      },
    });
    const { run } = setup({
      hooks: [forChildren],
      scripts: {
        Main: [calls(call('m', 'start_agent', { title: 'Child', task: 'Child task' })), say('ok')],
        'Child task': [
          (request) => {
            log.push(`child saw: ${request.messages.map((m) => m.content).join(' | ')}`);

            return [{ type: 'done', stopReason: 'end_turn' }];
          },
        ],
      },
    });

    await run('Main', [parentOnly]);

    expect(log).toEqual(['parent-only', 'for-children', 'child saw: Child task | child rule']);
  });

  it('gives sub-agents the sub-agent rules as system instructions', async () => {
    let instructions = '';
    const { run } = setup({
      scripts: {
        Main: [calls(call('m', 'start_agent', { title: 'Child', task: 'Child task' })), say('ok')],
        'Child task': [
          (request) => {
            instructions = request.instructions ?? '';

            return [{ type: 'done', stopReason: 'end_turn' }];
          },
        ],
      },
    });

    await run('Main');

    expect(instructions).toMatch(/^# Sub-agent role/);
    expect(instructions).toContain('report_status');
  });

  it('cancelling the task stops the sub-agent and ends its session as interrupted', async () => {
    const sessions = new SessionRegistry();
    const tasks = new TaskRegistry();
    const main = sessions.startMain({ title: 'Main' });
    const hanging: Provider = {
      async *stream(request) {
        await new Promise((resolve) =>
          request.signal.addEventListener('abort', resolve, { once: true }),
        );
        yield* [];
      },
    };
    const tool = createSubAgentTool({
      sessions,
      tasks,
      provider: hanging,
      runAgent: runSession,
      tools: [],
    });

    await tool.execute({
      input: { title: 'Slow', task: 'wait forever' },
      signal: new AbortController().signal,
      context: { callId, description: 'd', session: main },
    });
    const [task] = tasks.list();

    if (!task) throw new Error('start_agent started no task');
    await tasks.cancel(task.id);

    expect(tasks.get(task.id)?.status).toBe('cancelled');
    expect(sessions.children(main.id)[0]).toMatchObject({ state: 'interrupted' });
  });

  it('fails the task with the reason when the sub-agent did not finish, with no report', async () => {
    const { tasks, run } = setup({
      scripts: {
        'Do the thing': [
          calls(call('m1', 'start_agent', { title: 'Helper', task: 'Help out' })),
          say('All done.'),
        ],
      },
      // A run cut off before it finished: its last message is work in progress, not a report.
      runAgent: () =>
        Promise.resolve({
          reason: 'context_window_exceeded',
          messages: [{ role: 'assistant', content: 'half a thought', toolCalls: [] }],
        }),
    });

    await run('Do the thing');

    const [task] = tasks.list();

    if (!task) throw new Error('start_agent started no task');

    expect(task.status).toBe('failed');
    expect(task.error).toContain('context_window_exceeded');
    expect(task.output).not.toContain('half a thought');
    expect(tasks.report(task.id)).toBeUndefined();
  });
});

describe('report_status', () => {
  it('refuses to run outside a session', async () => {
    const sessions = new SessionRegistry();
    const { createReportStatusTool } = await import('@sheavly/tools/sub-agent/report-status.tool');
    const tool = createReportStatusTool({ sessions });

    await expect(
      tool.execute({
        input: { status: 'x' },
        signal: new AbortController().signal,
        context: { callId, description: 'd' },
      }),
    ).rejects.toThrow('only works inside an agent session');
  });
});

describe('main sessions', () => {
  it('a run without a session gets its own main session id on done', async () => {
    const { streamAgent } = await import('@sheavly/loop/stream-agent/stream-agent.helper');
    const ids: string[] = [];

    for (let i = 0; i < 2; i++) {
      for await (const event of streamAgent({
        provider: routedProvider({ hi: [say('hello')] }),
        tools: [
          defineTool({
            name: 'noop',
            description: 'n',
            inputSchema: z.object({}),
            execute: async () => '',
          }),
        ],
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        if (event.type === 'done') {
          expect(event.session).toMatchObject({ depth: 1, rootId: event.session.id });
          ids.push(event.session.id);
        }
      }
    }

    expect(ids[0]).not.toBe(ids[1]);
  });
});
