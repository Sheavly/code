import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskRegistry } from '../../../runtime/tasks/tasks.service.js';
import { useTempWorkspace } from '../../../testing/temp-workspace.fake.js';
import { toolRunner } from '@sheavly/testing/tool/tool-runner.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { createTaskTools } from '../../tasks/tasks.tool.js';
import { createRunCommandTool } from '../run-command.tool.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const signal = new AbortController().signal;

const temp = useTempWorkspace({ prefix: 'run-command-background-test-' });
let tasks: TaskRegistry;

afterEach(async () => {
  await tasks.cancelAll(); // never leave processes behind
});

function setup() {
  tasks = new TaskRegistry();

  return {
    run: toolRunner([
      createRunCommandTool({ workspace: temp.workspace, skipAllowList: true, tasks }),
      ...createTaskTools(tasks),
    ]),
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
    expect(tasks.get('t1')).toMatchObject({
      id: 't1',
      callId: 'c1',
      command: 'sleep 2 && echo late',
      description: 'call c1',
      status: 'running',
    });
  });

  it('records exit code and output when the command finishes', async () => {
    const { run } = setup();

    await run('ok', 'run_command', { command: 'echo hello', background: true });
    await run('bad', 'run_command', { command: 'echo oops >&2; exit 3', background: true });

    await until(() => tasks.runningCount === 0);
    expect(tasks.get('t1')).toMatchObject({ status: 'completed', exitCode: 0, output: 'hello\n' });
    expect(tasks.get('t2')).toMatchObject({ status: 'failed', exitCode: 3, output: 'oops\n' });
    expect(tasks.get('t1')?.endedAt).toBeGreaterThanOrEqual(tasks.get('t1')!.startedAt);
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
    const tool = createRunCommandTool({ workspace: temp.workspace, skipAllowList: true });

    tasks = new TaskRegistry();
    const result = await runTool({
      tools: [tool],
      call: {
        id: 'x',
        name: 'run_command',
        input: { description: 'bg', command: 'true', background: true },
      },
      signal,
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.role === 'tool' && result.content).toContain('not enabled');
  });

  it('still applies the allow list', async () => {
    tasks = new TaskRegistry();
    const tool = createRunCommandTool({ workspace: temp.workspace, tasks });
    const result = await runTool({
      tools: [tool],
      call: {
        id: 'x',
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
    expect(tasks.get('t1')).toMatchObject({ status: 'cancelled' });

    await sleep(1_300);
    expect(existsSync(marker)).toBe(false);
  });
});
