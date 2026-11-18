import { describe, expect, it, vi } from 'vitest';
import type { TaskInfo } from '@sheavly/protocol/task/task.types';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { TaskControl } from '@sheavly/runtime/tasks/task-scope.types';
import { toolRunner } from '@sheavly/testing/tool/tool-runner.fake';
import { createTaskTools } from '../tasks.tool.js';

const t1 = taskIdSchema.parse('t1');
const running: TaskInfo = {
  id: t1,
  command: 'wait',
  description: 'waits',
  kind: 'task',
  status: 'running',
  startedAt: 1,
  output: '',
};

/** A `TaskControl` that is not a registry: every call is recorded, and it knows one running task. */
function control() {
  const getOwned = vi.fn<TaskControl['getOwned']>(({ id }) => (id === t1 ? running : undefined));
  const list = vi.fn<TaskControl['list']>(() => [running]);
  const report = vi.fn<TaskControl['report']>(() => undefined);
  const cancel = vi.fn<TaskControl['cancel']>(async () => ({ ...running, status: 'cancelled' }));
  const group = vi.fn<TaskControl['group']>();

  return {
    scope: { getOwned, list, report, cancel, group } satisfies TaskControl,
    ...{ getOwned, list, report, cancel, group },
  };
}

describe('the task tools over a TaskControl', () => {
  it('asks for the calling session on every read, list and cancel', async () => {
    const { scope, getOwned, list, report, cancel } = control();
    const session = new SessionRegistry().startMain({ title: 'Main' });
    const run = toolRunner(createTaskTools(scope), session);

    await run('c1', 'task_status', { id: 't1' });
    await run('c2', 'task_status', {});
    await run('c3', 'cancel_task', { id: 't1' });

    expect(getOwned).toHaveBeenCalledWith({ id: t1, sessionId: session.id });
    expect(report).toHaveBeenCalledWith(t1, session.id);
    expect(list).toHaveBeenCalledWith(session.id);
    expect(cancel).toHaveBeenCalledWith({ id: t1, sessionId: session.id });
  });

  it('groups through the control with the calling session', async () => {
    const { scope, group } = control();
    const session = new SessionRegistry().startMain({ title: 'Main' });
    const result = await toolRunner(createTaskTools(scope), session)('c1', 'await_tasks', {
      ids: ['t1'],
      reason: 'needed next',
    });

    expect(result.isError).toBe(false);
    expect(group).toHaveBeenCalledWith({ ids: [t1], reason: 'needed next', sessionId: session.id });
  });

  it('reads an id the control does not know as not found, and never cancels it', async () => {
    const { scope, cancel } = control();
    const session = new SessionRegistry().startMain({ title: 'Main' });
    const run = toolRunner(createTaskTools(scope), session);

    expect(await run('c1', 'task_status', { id: 't2' })).toMatchObject({ isError: true });
    expect(await run('c2', 'cancel_task', { id: 't2' })).toMatchObject({ isError: true });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('refuses a call outside a session without touching the control', async () => {
    const { scope, getOwned, list } = control();
    const result = await toolRunner(createTaskTools(scope))('c1', 'task_status', {});

    expect(result.isError).toBe(true);
    expect(getOwned).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
});
