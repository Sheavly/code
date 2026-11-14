import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { toolRunner } from '@sheavly/testing/tool/tool-runner.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { createTaskTools } from '@sheavly/tools/tasks/tasks.tool';
import { createRunCommandTool } from '../run-command.tool.js';
import { testPermissions } from '../../testing/permissions.fake.js';
import { testProcesses } from '@sheavly/workspace/testing/process-runner.fake';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const signal = new AbortController().signal;
const t1 = taskIdSchema.parse('t1');
const callId = callIdSchema.parse('x');

const temp = useTempWorkspace({ prefix: 'run-command-background-test-' });
let tasks: TaskRegistry;

afterEach(async () => {
  await tasks.cancelAll(); // never leave processes behind
  vi.restoreAllMocks();
});

/** Called as one session: the task tools refuse a call that has none. */
function setup() {
  tasks = new TaskRegistry();

  const session = new SessionRegistry().startMain({ title: 'Main' });

  return {
    run: toolRunner(
      [
        createRunCommandTool({
          processes: testProcesses(),
          workspace: temp.workspace,
          permissions: testPermissions({ mode: 'allow_all' }),
          tasks,
        }),
        ...createTaskTools(tasks),
      ],
      session,
    ),
  };
}

describe('background run_command', () => {
  it('returns immediately with a task id while the command keeps running', async () => {
    const { run } = setup();
    const started = performance.now();
    const result = await run('c1', 'run_command', {
      command: 'sleep 2 && echo late',
      background: true,
    });

    expect(performance.now() - started).toBeLessThan(500);
    expect(result).toMatchObject({ role: 'tool', isError: false });
    expect(result.role === 'tool' && result.content).toContain('Started background task t1');
    expect(tasks.get(t1)).toMatchObject({
      id: 't1',
      callId: 'c1',
      command: 'sleep 2 && echo late',
      description: 'call c1',
      status: 'running',
    });
    expect(tasks.hasPendingTasks()).toBe(true);
    expect(result.role === 'tool' && result.content).toContain('end your turn without tool calls');
    expect(result.role === 'tool' && result.content).toContain('Do not poll');
  });

  it.each([undefined, 'task', 'service'] as const)(
    'forwards the background kind to the registry without legacy lifecycle flags: %s',
    async (backgroundKind) => {
      const { run } = setup();
      const start = vi.spyOn(tasks, 'start');
      const result = await run('kind', 'run_command', {
        command: 'sleep 5',
        background: true,
        ...(backgroundKind && { backgroundKind }),
      });

      expect(result.isError).toBe(false);
      expect(start).toHaveBeenCalledOnce();
      expect(start.mock.calls[0]?.[0]).toMatchObject({
        backgroundKind: backgroundKind ?? 'task',
      });
      expect(Object.keys(start.mock.calls[0]![0]).sort()).toEqual([
        'backgroundKind',
        'callId',
        'command',
        'description',
        'run',
        'sessionId',
      ]);
      expect(tasks.hasPendingTasks()).toBe(backgroundKind !== 'service');
    },
  );

  it.each(['task', 'service'] as const)(
    'does not launch a %s after an aborted permission lookup resolves past shutdown',
    async (backgroundKind) => {
      tasks = new TaskRegistry();
      const permissions = testPermissions({ mode: 'allow_all' });
      const permissionResult =
        Promise.withResolvers<Awaited<ReturnType<typeof permissions.read>>>();
      const read = vi.spyOn(permissions, 'read').mockReturnValue(permissionResult.promise);
      const processes = testProcesses();
      const launch = vi
        .spyOn(processes, 'runScript')
        .mockRejectedValue(new Error('Unexpected process launch'));
      const start = vi.spyOn(tasks, 'start');
      const controller = new AbortController();
      const running = runTool({
        tools: [createRunCommandTool({ workspace: temp.workspace, permissions, processes, tasks })],
        call: {
          id: callId,
          name: 'run_command',
          input: {
            description: 'Delayed command',
            command: 'echo never',
            background: true,
            backgroundKind,
          },
        },
        signal: controller.signal,
      });

      await until(() => read.mock.calls.length === 1);
      controller.abort();
      await tasks.cancelAll();
      permissionResult.resolve({ mode: 'allow_all', allow: [] });
      const result = await running;

      expect(result.isError).toBe(true);
      expect(start).not.toHaveBeenCalled();
      expect(launch).not.toHaveBeenCalled();
      expect(tasks.list()).toEqual([]);
    },
  );

  it('rejects an unknown background kind before starting a process', async () => {
    const { run } = setup();
    const result = await run('invalid', 'run_command', {
      command: 'echo never',
      background: true,
      backgroundKind: 'unknown',
    });

    expect(result).toMatchObject({ isError: true });
    expect(tasks.list()).toEqual([]);
  });

  it('does not create a background task for a foreground command', async () => {
    const { run } = setup();
    const result = await run('foreground', 'run_command', {
      command: 'echo foreground',
      backgroundKind: 'service',
    });

    expect(result.role === 'tool' && result.content).toContain('foreground');
    expect(tasks.list()).toEqual([]);
    expect(tasks.hasPendingTasks()).toBe(false);
  });

  it('records exit code and output when the command finishes', async () => {
    const { run } = setup();

    await run('ok', 'run_command', { command: 'echo hello', background: true });
    // No shell: a redirect or `exit` would be refused, so a real program fails with code 3.
    await run('bad', 'run_command', {
      command: `node -e 'process.stderr.write("oops\\n"); process.exit(3)'`,
      background: true,
    });

    await until(() => tasks.runningCount === 0);
    expect(tasks.get(t1)).toMatchObject({ status: 'completed', exitCode: 0, output: 'hello\n' });
    expect(tasks.get(taskIdSchema.parse('t2'))).toMatchObject({
      status: 'failed',
      exitCode: 3,
      output: 'oops\n',
    });
    expect(tasks.get(t1)?.endedAt).toBeGreaterThanOrEqual(tasks.get(t1)!.startedAt);
  });

  it('runs several tasks concurrently', async () => {
    const { run } = setup();
    const started = performance.now();

    for (const id of ['a', 'b', 'c']) {
      await run(id, 'run_command', { command: 'sleep 0.4', background: true });
    }

    expect(tasks.runningCount).toBe(3);
    await until(() => tasks.runningCount === 0);
    // Serially this would take 1.2s+.
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(tasks.list().map((t) => t.status)).toEqual(['completed', 'completed', 'completed']);
  });

  it('is refused when the harness has no task registry', async () => {
    const tool = createRunCommandTool({
      processes: testProcesses(),
      workspace: temp.workspace,
      permissions: testPermissions({ mode: 'allow_all' }),
    });

    tasks = new TaskRegistry();
    const result = await runTool({
      tools: [tool],
      call: {
        id: callId,
        name: 'run_command',
        input: { description: 'bg', command: 'true', background: true },
      },
      signal,
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.role === 'tool' && result.content).toContain('not enabled');
  });

  it('still asks before running a command the user has not allowed', async () => {
    tasks = new TaskRegistry();
    const tool = createRunCommandTool({
      processes: testProcesses(),
      workspace: temp.workspace,
      permissions: testPermissions(),
      tasks,
    });
    const result = await runTool({
      tools: [tool],
      call: {
        id: callId,
        name: 'run_command',
        input: { description: 'bg', command: 'sleep 5', background: true },
      },
      signal,
    });

    expect(result).toMatchObject({ isError: true });
    expect(tasks.list()).toEqual([]);
  });

  it('cancellation kills the whole process tree', async () => {
    const { run } = setup();
    const marker = path.join(temp.root, 'cancelled-marker');

    await run('c1', 'run_command', { command: `sleep 1 && touch ${marker}`, background: true });

    const result = await run('c2', 'cancel_task', { id: 't1' });

    expect(result.role === 'tool' && result.content).toContain('Cancelled task t1');
    expect(tasks.get(t1)).toMatchObject({ status: 'cancelled' });

    await sleep(1_300);
    expect(existsSync(marker)).toBe(false);
  });
});
