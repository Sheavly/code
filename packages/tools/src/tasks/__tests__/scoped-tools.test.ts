import { afterEach, describe, expect, it } from 'vitest';
import { toolRunner } from '@sheavly/testing/tool/tool-runner.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { startParentAndChild } from '@sheavly/runtime/testing/sessions.fake';
import { startTaskTool } from '@sheavly/runtime/testing/start-task.fake';
import { createTaskTools } from '../tasks.tool.js';

let tasks = new TaskRegistry();

afterEach(async () => {
  await tasks.cancelAll();
});

/** Two sessions of one run, each calling the same tools on the run's one registry. */
function twoSessions() {
  tasks = new TaskRegistry();

  const { parent, child } = startParentAndChild(new SessionRegistry());
  const tools = [startTaskTool(tasks), ...createTaskTools(tasks)];

  return { parent: toolRunner(tools, parent), child: toolRunner(tools, child) };
}

describe('task tools on a registry shared by sessions', () => {
  it('lists only the tasks the calling session started', async () => {
    const { parent, child } = twoSessions();

    await parent('p1', 'start_task', { ms: 5_000 });
    await child('c1', 'start_task', { ms: 5_000 });

    const list = await child('c2', 'task_status', {});

    expect(list.role === 'tool' && list.content).toContain('[task t2 · running');
    expect(list.role === 'tool' && list.content).not.toContain('[task t1');
  });

  it('answers a foreign task id as unknown, for status and for cancel', async () => {
    const { parent, child } = twoSessions();

    await parent('p1', 'start_task', { ms: 5_000 });

    const status = await child('c1', 'task_status', { id: 't1' });
    const cancel = await child('c2', 'cancel_task', { id: 't1' });

    expect(status).toMatchObject({ isError: true });
    expect(status.role === 'tool' && status.content).toContain('No task with id t1');
    expect(cancel).toMatchObject({ isError: true });
    expect(cancel.role === 'tool' && cancel.content).toContain('No task with id t1');
    expect(tasks.get(taskIdSchema.parse('t1'))?.status).toBe('running');
  });

  it.each([
    ['task_status', {}],
    ['cancel_task', { id: 't1' }],
    ['await_tasks', { ids: ['t1'], reason: 'Check the run.' }],
  ])('refuses %s without a session, so it cannot see every session', async (name, input) => {
    tasks = new TaskRegistry();

    const run = toolRunner([startTaskTool(tasks), ...createTaskTools(tasks)]);

    await run('p1', 'start_task', { ms: 5_000 });

    const result = await run('c1', name, input);

    expect(result).toMatchObject({ isError: true });
    expect(result.role === 'tool' && result.content).toContain(
      'only works inside an agent session',
    );
    expect(tasks.get(taskIdSchema.parse('t1'))?.status).toBe('running');
  });

  it('answers a released id of another session like an unknown one', async () => {
    const { parent, child } = twoSessions();

    await parent('p1', 'start_task', { ms: 0 });
    await until(() => tasks.runningCount === 0);
    tasks.takeUnreported();
    tasks.release(taskIdSchema.parse('t1'));

    const released = await child('c1', 'task_status', { id: 't1' });
    const unknown = await child('c2', 'task_status', { id: 't9' });
    const words = (message: typeof released, id: string) =>
      (message.role === 'tool' ? message.content : '').replaceAll(id, 'tN');

    expect(words(released, 't1')).toBe(words(unknown, 't9'));
  });

  it('lets a session cancel its own task', async () => {
    const { child } = twoSessions();

    await child('c1', 'start_task', { ms: 5_000 });

    expect(await child('c2', 'cancel_task', { id: 't1' })).toMatchObject({ isError: false });
    expect(tasks.get(taskIdSchema.parse('t1'))?.status).toBe('cancelled');
  });
});
