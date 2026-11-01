import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TaskRegistry } from '../../../runtime/tasks/tasks.service.js';
import { Workspace } from '../../../runtime/workspace/workspace.service.js';
import type { ToolCall } from '@sheavly/core/message/message.types';
import { runTool } from '@sheavly/core/tool/tool.service';
import { createRunCommandTool } from '../../run-command/run-command.tool.js';
import { createTaskTools } from '../tasks.tool.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const signal = new AbortController().signal;

let root: string;
let workspace: Workspace;
let tasks: TaskRegistry;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tasks-test-'));
  workspace = await Workspace.open(root);
});
afterEach(async () => {
  await tasks.cancelAll(); // never leave processes behind
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function setup() {
  tasks = new TaskRegistry();
  const tools = [
    createRunCommandTool({ workspace, skipAllowList: true, tasks }),
    ...createTaskTools(tasks),
  ];
  const run = (id: string, name: string, input: Record<string, unknown>) =>
    runTool({
      tools,
      call: { id, name, input: { description: `call ${id}`, ...input } } satisfies ToolCall,
      signal,
    });

  return { run };
}

/** Polls until `check` is true (tasks finish on their own schedule). */
async function until(check: () => boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;

  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await sleep(10);
  }
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
    const tool = createRunCommandTool({ workspace, skipAllowList: true });

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
    const tool = createRunCommandTool({ workspace, tasks });
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
});

describe('cancel_task and task_status', () => {
  it('cancellation kills the whole process tree', async () => {
    const { run } = setup();
    const marker = path.join(root, 'cancelled-marker');

    await run('c1', 'run_command', { command: `sleep 1 && touch ${marker}`, background: true });

    const result = await run('c2', 'cancel_task', { id: 't1' });

    expect(result.role === 'tool' && result.content).toContain('Cancelled task t1');
    expect(tasks.get('t1')).toMatchObject({ status: 'cancelled' });

    await sleep(1_300);
    expect(existsSync(marker)).toBe(false);
  });

  it("a cancelled task isn't reported back as a completion (the canceller already knows)", async () => {
    const { run } = setup();

    await run('c1', 'run_command', { command: 'sleep 5', background: true });
    await run('c2', 'cancel_task', { id: 't1' });
    expect(tasks.takeUnreported()).toEqual([]);
  });

  it('task_status lists tasks, or shows one with its output', async () => {
    const { run } = setup();

    await run('c1', 'run_command', { command: 'echo hi', background: true });
    await run('c2', 'run_command', { command: 'sleep 5', background: true });
    await until(() => tasks.get('t1')?.status === 'completed');

    const list = await run('s1', 'task_status', {});

    expect(list.role === 'tool' && list.content).toMatch(
      /\[task t1 · completed · exit code 0 · .*\] \$ echo hi/,
    );
    expect(list.role === 'tool' && list.content).toMatch(/\[task t2 · running · .*\] \$ sleep 5/);

    const one = await run('s2', 'task_status', { id: 't1' });

    expect(one.role === 'tool' && one.content).toContain('hi');
  });

  it("unknown ids are errors, finished tasks can't be cancelled", async () => {
    const { run } = setup();

    expect(await run('s', 'task_status', { id: 't9' })).toMatchObject({ isError: true });
    expect(await run('c', 'cancel_task', { id: 't9' })).toMatchObject({ isError: true });

    await run('c1', 'run_command', { command: 'true', background: true });
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
