import { describe, expect, it } from 'vitest';
import { ExtensionUndeclaredError } from '@sheavly/extension/errors/manifest.errors';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import { TaskError } from '@sheavly/runtime/errors/tasks.errors';
import { finiteWork, startWork } from '@sheavly/runtime/tasks/work.utils';

import { ScopeArgumentError, ScopeDeactivatedError } from '../../errors/scopes.errors.js';
import { scopeRun } from '../../testing/scope-run.fake.js';
import { waitingWork as waiting } from '../../testing/waiting-work.fake.js';
import { BACKGROUND_TASKS, TASK_CONTROL } from '../run-services.utils.js';

const unknown = taskIdSchema.parse('t99');
const control = (name: string, grants: string[]) => ({
  name,
  requires: [TASK_CONTROL.name, BACKGROUND_TASKS.name],
  grants,
});
const both = ['task:read-any', 'task:cancel-any', 'task:start'];

/** A run with a main session, a child and one task on each, started by the registry itself. */
async function runWithTasks(grants = both) {
  const run = scopeRun();
  const main = run.harness.mainSession.id;
  const child = run.harness.sessions.startChild({
    parentId: main,
    startedByCall: callIdSchema.parse('c1'),
    title: 'child',
  });

  await run.activate([control('c', grants)]);

  const registry = run.harness.tasks;
  const onMain = startWork({ tasks: registry, work: waiting(main) });
  const onChild = startWork({ tasks: registry, work: waiting(child.id) });

  return { run, main, child, onMain, onChild, tasks: run.servicesOf('c').get(TASK_CONTROL) };
}

describe('the task-control service', () => {
  it('reads and cancels any task of a session, whatever started it', async () => {
    const { main, onMain, tasks } = await runWithTasks();

    expect(tasks.getOwned({ id: onMain.id, sessionId: main })?.id).toBe(onMain.id);
    expect(tasks.list(main).map((task) => task.id)).toEqual([onMain.id]);
    expect(tasks.report(onMain.id, main)).toBeUndefined();
    await expect(tasks.cancel({ id: onMain.id, sessionId: main })).resolves.toMatchObject({
      status: 'cancelled',
    });
  });

  it('treats another session’s task as unknown: getOwned, report and cancel', async () => {
    const { run, main, onChild, tasks } = await runWithTasks();

    expect(tasks.getOwned({ id: onChild.id, sessionId: main })).toBeUndefined();
    expect(tasks.report(onChild.id, main)).toBeUndefined();
    await expect(tasks.cancel({ id: onChild.id, sessionId: main })).resolves.toBeUndefined();
    expect(run.harness.tasks.get(onChild.id)?.status).toBe('running');
    expect(() => tasks.group({ ids: [onChild.id], reason: 'r', sessionId: main })).toThrow(
      TaskError,
    );
    await run.harness.tasks.cancelAll();
  });

  it('reads the whole report of a settled task of the session', async () => {
    const run = scopeRun();
    const main = run.harness.mainSession.id;

    await run.activate([control('c', both)]);

    const done = startWork({
      tasks: run.harness.tasks,
      work: finiteWork({
        command: 'say',
        description: 'says',
        sessionId: main,
        run: async () => ({ exitCode: 0, report: 'the report' }),
      }),
    });
    const tasks = run.servicesOf('c').get(TASK_CONTROL);

    await run.harness.tasks.nextSettled();

    expect(tasks.report(done.id, main)).toBe('the report');
  });

  it('requires a sessionId on every verb, and never reads a missing one as every task', async () => {
    const { run, tasks, onMain } = await runWithTasks();
    // What a caller that ignores the types does: no session.
    const loose = tasks as unknown as Record<string, (...args: unknown[]) => unknown>;
    const id = onMain.id;

    expect(() => loose.list?.(undefined)).toThrow(ScopeArgumentError);
    expect(() => loose.getOwned?.({ id })).toThrow(ScopeArgumentError);
    expect(() => loose.report?.(id, undefined)).toThrow(ScopeArgumentError);
    expect(() => loose.group?.({ ids: [id], reason: 'r' })).toThrow(ScopeArgumentError);
    await expect(loose.cancel?.({ id })).rejects.toThrow(ScopeArgumentError);
    await run.harness.tasks.cancelAll();
  });

  it('groups tasks of the session', async () => {
    const { run, main, onMain, tasks } = await runWithTasks();

    tasks.group({ ids: [onMain.id], reason: 'together', sessionId: main });

    expect(run.harness.tasks.get(onMain.id)?.reason).toBe('together');
    await run.harness.tasks.cancelAll();
  });

  it('refuses each verb without its grant, naming the extension and the grant', async () => {
    const { run, main, onMain, tasks } = await runWithTasks([]);
    const verbs: [string, () => unknown][] = [
      ['task:read-any', () => tasks.getOwned({ id: onMain.id, sessionId: main })],
      ['task:read-any', () => tasks.list(main)],
      ['task:read-any', () => tasks.report(onMain.id, main)],
      ['task:cancel-any', () => tasks.group({ ids: [onMain.id], reason: 'r', sessionId: main })],
    ];

    for (const [grant, verb] of verbs) {
      expect(verb).toThrow(ExtensionUndeclaredError);
      expect(verb).toThrow(new RegExp(`c.*${grant}`, 's'));
    }

    await expect(tasks.cancel({ id: onMain.id, sessionId: main })).rejects.toThrow(
      /task:cancel-any/,
    );
    expect(run.harness.tasks.get(onMain.id)?.status).toBe('running');
    await run.harness.tasks.cancelAll();
  });

  it('checks read-any and cancel-any separately, and lets neither start work', async () => {
    const { run, main, onMain, tasks } = await runWithTasks(['task:read-any']);

    expect(tasks.list(main)).toHaveLength(1);
    await expect(tasks.cancel({ id: onMain.id, sessionId: main })).rejects.toThrow(
      /task:cancel-any/,
    );

    for (const name of ['start', 'cancelAll', 'cancelSession', 'takeDeliveries', 'release']) {
      expect(name in tasks).toBe(false);
    }

    expect(Object.isFrozen(tasks)).toBe(true);
    expect(tasks.getOwned({ id: unknown, sessionId: main })).toBeUndefined();
    await run.harness.tasks.cancelAll();
  });

  it('throws deactivated after the host stops the extension', async () => {
    const run = scopeRun();
    const { deactivate } = await run.activate([control('c', both)]);
    const tasks = run.servicesOf('c').get(TASK_CONTROL);

    await deactivate();

    expect(() => tasks.list(run.harness.mainSession.id)).toThrow(ScopeDeactivatedError);
    await expect(
      tasks.cancel({ id: unknown, sessionId: run.harness.mainSession.id }),
    ).rejects.toThrow(ScopeDeactivatedError);
  });
});
