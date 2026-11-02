import { afterEach, describe, expect, it } from 'vitest';
import { TaskRegistry } from '../../../runtime/tasks/tasks.service.js';
import { startTaskTool } from '../../../testing/start-task.fake.js';
import { toolRunner } from '@sheavly/testing/tool/tool-runner.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import { createTaskTools } from '../tasks.tool.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let tasks: TaskRegistry;

afterEach(async () => {
  await tasks.cancelAll();
});

/** The task tools next to `start_task`, which starts timed tasks (no workspace or process). */
function setup() {
  tasks = new TaskRegistry();

  return { run: toolRunner([startTaskTool(tasks), ...createTaskTools(tasks)]) };
}

describe('cancel_task and task_status', () => {
  it("cancel_task stops a task, and it isn't reported back as a completion", async () => {
    const { run } = setup();

    await run('c1', 'start_task', { ms: 5_000 });
    expect(await run('c2', 'cancel_task', { id: 't1' })).toMatchObject({ isError: false });
    expect(tasks.get('t1')).toMatchObject({ status: 'cancelled', exitCode: null });
    expect(tasks.takeUnreported()).toEqual([]); // the canceller already knows
  });

  it('task_status lists tasks, or shows one with its output', async () => {
    const { run } = setup();

    await run('c1', 'start_task', { ms: 0, output: 'hi\n' });
    await run('c2', 'start_task', { ms: 5_000 });
    await until(() => tasks.get('t1')?.status === 'completed');

    const list = await run('s1', 'task_status', {});

    expect(list.role === 'tool' && list.content).toMatch(
      /\[task t1 · completed · exit code 0 · .*\] \$ wait 0ms/,
    );
    expect(list.role === 'tool' && list.content).toMatch(
      /\[task t2 · running · .*\] \$ wait 5000ms/,
    );

    const one = await run('s2', 'task_status', { id: 't1' });

    expect(one.role === 'tool' && one.content).toContain('hi');
  });

  it("unknown ids are errors, finished tasks can't be cancelled", async () => {
    const { run } = setup();

    expect(await run('s', 'task_status', { id: 't9' })).toMatchObject({ isError: true });
    expect(await run('c', 'cancel_task', { id: 't9' })).toMatchObject({ isError: true });

    await run('c1', 'start_task', { ms: 0 });
    await until(() => tasks.runningCount === 0);
    const result = await run('c2', 'cancel_task', { id: 't1' });

    expect(result.role === 'tool' && result.content).toContain('already completed');
  });
});

describe('TaskRegistry', () => {
  it('reports each finished task once, in the order they finished', async () => {
    tasks = new TaskRegistry();
    const after = (ms: number, exitCode: number) => () => sleep(ms).then(() => ({ exitCode }));

    tasks.start({ command: 'slow', description: 'slow', run: after(80, 0) });
    tasks.start({ command: 'fast', description: 'fast', run: after(10, 1) });

    await until(() => tasks.runningCount === 0);
    expect(tasks.takeUnreported().map((t) => [t.command, t.status])).toEqual([
      ['fast', 'failed'],
      ['slow', 'completed'],
    ]);
    expect(tasks.takeUnreported()).toEqual([]);
  });

  it('a task that throws is failed with the error message', async () => {
    tasks = new TaskRegistry();
    tasks.start({
      command: 'x',
      description: 'x',
      run: async () => Promise.reject(new Error('spawn ENOENT')),
    });
    await until(() => tasks.runningCount === 0);
    expect(tasks.get('t1')).toMatchObject({ status: 'failed', error: 'spawn ENOENT' });
  });

  it('returns snapshots, not live objects', () => {
    tasks = new TaskRegistry();
    const info = tasks.start({
      command: 'x',
      description: 'x',
      run: ({ signal: s }) =>
        new Promise((resolve) => s.addEventListener('abort', () => resolve({ exitCode: null }))),
    });

    info.status = 'completed';
    expect(tasks.get('t1')?.status).toBe('running');
  });
});
