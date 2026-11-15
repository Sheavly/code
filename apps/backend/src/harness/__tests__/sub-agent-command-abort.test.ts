import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRunCommandTool } from '@sheavly/coding/run-command/run-command.tool';
import { createStartServiceTool } from '@sheavly/coding/run-command/start-service.tool';
import type { RunCommandOptions } from '@sheavly/coding/run-command/run-command.types';
import { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { historyMessageSchema } from '@sheavly/protocol/history/history.validator';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import {
  calls,
  routedProvider,
  say,
  toolCall,
} from '@sheavly/testing/provider/routed-provider.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';
import { ProcessRunner } from '@sheavly/workspace/process/process.service';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';

const temp = useTempWorkspace({ prefix: 'sub-agent-command-abort-' });

afterEach(() => vi.restoreAllMocks());

function instrumentChild(params: {
  options: RunCommandOptions & { tasks: TaskRegistry };
  create: typeof createRunCommandTool | typeof createStartServiceTool;
}) {
  const { options, create } = params;
  const tool = create(options);

  return {
    tasks: options.tasks,
    start: vi.spyOn(options.tasks, 'start'),
    cleanup: vi.spyOn(options.tasks, 'cancelSession'),
    execute: vi.spyOn(tool, 'execute'),
    tool,
  };
}

function expectPairedHistory(messages: HistoryMessage[], callId: string, isError: boolean) {
  for (const message of messages) {
    expect(historyMessageSchema.safeParse(message).success).toBe(true);
  }

  const toolHistory = messages.filter(
    (message) =>
      message.role === 'tool' || (message.role === 'assistant' && message.toolCalls.length > 0),
  );

  expect(toolHistory).toMatchObject([
    { role: 'assistant', toolCalls: [{ id: callId }] },
    { role: 'tool', toolCallId: callId, isError },
  ]);
}

describe('sub-agent command permissions resolving after parent interruption', () => {
  it.each([
    { name: 'run_command', create: createRunCommandTool },
    { name: 'start_service', create: createStartServiceTool },
  ])(
    'does not register or launch a late $name after the child session is cleaned up',
    async ({ name, create }) => {
      const permissionResult =
        Promise.withResolvers<Awaited<ReturnType<RunCommandOptions['permissions']['read']>>>();
      const permissions = {
        read: vi.fn(() => permissionResult.promise),
        allow: vi.fn(() => Promise.resolve()),
      };
      const processes = new ProcessRunner({ env: {} });
      const launch = vi
        .spyOn(processes, 'runScript')
        .mockRejectedValue(new Error('Unexpected process launch'));
      const sessions = new SessionRegistry();
      const tasks = new TaskRegistry();
      const main = sessions.startMain({ title: 'Parent' });
      const controller = new AbortController();
      const childBuilt = Promise.withResolvers<ReturnType<typeof instrumentChild>>();
      const runChild = vi.fn(runSession);
      const provider = routedProvider({
        Parent: [
          calls(
            toolCall({
              id: 'start-child',
              name: 'start_agent',
              input: { title: 'Child', task: 'Child' },
            }),
          ),
          say('Waiting for the child'),
        ],
        Child: [
          calls(
            toolCall({
              id: 'delayed-command',
              name,
              input: { command: 'echo never', background: true },
            }),
          ),
          say('Command finished'),
        ],
      });
      const startAgent = createSubAgentTool({
        sessions,
        tasks,
        provider,
        runAgent: runChild,
        tools: [],
        tasksTools: (childTasks) => {
          const child = instrumentChild({
            create,
            options: {
              workspace: temp.workspace,
              permissions,
              processes,
              tasks: childTasks,
            },
          });

          childBuilt.resolve(child);

          return [child.tool];
        },
      });
      const running = runSession({
        provider,
        tools: [startAgent],
        messages: [{ role: 'user', content: 'Parent' }],
        tasks,
        signal: controller.signal,
        session: { registry: sessions, ref: main },
      });
      const child = await childBuilt.promise;

      try {
        await until(() => permissions.read.mock.calls.length === 1);
        expect(child.tasks).toBe(tasks);
        expect(child.execute).toHaveBeenCalledOnce();
        expect(child.execute.mock.calls[0]?.[0].signal.aborted).toBe(false);
        // Only the sub-agent's own task: the command has not been registered.
        expect(tasks.list()).toMatchObject([{ callId: 'start-child' }]);
        controller.abort();

        // Permission storage deliberately ignores abort. Both loops and the factory's final
        // cleanup must finish before that original tool execution is allowed to continue.
        const parentResult = await running;

        expect(runChild).toHaveBeenCalledOnce();
        const childRun = runChild.mock.results[0]!;

        if (childRun.type !== 'return') {
          throw new Error('The child runner did not return a promise');
        }

        const childResult = await childRun.value;

        expect(parentResult.reason).toBe('interrupted');
        expect(childResult.reason).toBe('interrupted');
        expect(sessions.get(main.id)?.state).toBe('interrupted');
        expect(sessions.children(main.id)).toHaveLength(1);
        expect(sessions.children(main.id)[0]).toMatchObject({
          state: 'interrupted',
          parentId: main.id,
          startedByCall: 'start-child',
        });
        expect(tasks.list()).toMatchObject([{ status: 'cancelled', callId: 'start-child' }]);
        expect(child.cleanup).toHaveBeenCalledWith(sessions.children(main.id)[0]?.id);
        expect(child.execute.mock.calls[0]?.[0].signal.aborted).toBe(true);
        expectPairedHistory(parentResult.messages, 'start-child', false);
        expectPairedHistory(childResult.messages, 'delayed-command', true);
        const parentHistory = structuredClone(parentResult.messages);
        const childHistory = structuredClone(childResult.messages);

        permissionResult.resolve({ mode: 'allow_all', allow: [] });
        await expect(child.execute.mock.results[0]!.value).rejects.toMatchObject({
          name: 'AbortError',
        });
        expect(child.start).not.toHaveBeenCalled();
        expect(launch).not.toHaveBeenCalled();
        expect(tasks.list()).toMatchObject([{ status: 'cancelled', callId: 'start-child' }]);
        expect(tasks.runningCount).toBe(0);
        expect(processes.running).toBe(0);
        // The late completion cannot replace the interrupted placeholder or mutate history.
        expect(parentResult.messages).toEqual(parentHistory);
        expect(childResult.messages).toEqual(childHistory);
      } finally {
        controller.abort();
        permissionResult.resolve({ mode: 'allow_all', allow: [] });
        await running;
        await tasks.cancelAll();
      }
    },
  );
});
