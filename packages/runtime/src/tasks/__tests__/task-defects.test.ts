import { describe, expect, it } from 'vitest';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { TaskError } from '../../errors/tasks.errors.js';
import { TaskRegistry } from '../tasks.service.js';

// Each `it.fails` states the rule and breaks on today's code: it turns red when the defect is
// fixed, and the fixing change flips it to `it`. See "The flow that must hold" in
// `.agents/skills/sheavly/state-machines.md`.

function finishedTask(tasks: TaskRegistry, backgroundKind: 'task' | 'service' = 'task') {
  const finish = Promise.withResolvers<{ exitCode: number; report?: string }>();
  const info = tasks.start({
    command: 'review',
    description: 'Review',
    backgroundKind,
    run: () => finish.promise,
  });

  return { id: info.id, finish };
}

describe('finished work reaches the model once', () => {
  // A delivered service is refused as a service first: the kind check precedes the delivered one.
  it.each([
    ['task', 'task_delivered'],
    ['service', 'service_task'],
  ] as const)(
    'rule 5: grouping a %s whose notice was already delivered is refused (%s) and notifies nothing',
    async (backgroundKind, reason) => {
      const tasks = new TaskRegistry();
      const { id, finish } = finishedTask(tasks, backgroundKind);
      const settled = tasks.nextSettled();

      finish.resolve({ exitCode: 0 });
      await settled;
      expect(tasks.takeDeliveries()).toHaveLength(1);

      const grouping = () => tasks.group({ ids: [id], reason: 'Too late' });

      expect(grouping).toThrow(expect.objectContaining({ name: 'TaskError', reason }));
      expect(tasks.hasDeliveries()).toBe(false);
    },
  );

  it('rule 5: a task that returned a report is refused once delivered, with the model-facing message', async () => {
    const tasks = new TaskRegistry();
    const { id, finish } = finishedTask(tasks);
    const settled = tasks.nextSettled();

    finish.resolve({ exitCode: 0, report: 'Done' });
    await settled;
    tasks.takeDeliveries();

    expect(() => tasks.group({ ids: [id], reason: 'Too late' })).toThrow(
      `Task ${id} was already reported and cannot be grouped`,
    );
  });

  it('a refused group changes nothing, so the other member can still be grouped', async () => {
    const tasks = new TaskRegistry();
    const delivered = finishedTask(tasks);
    const running = finishedTask(tasks);
    const settled = tasks.nextSettled();

    delivered.finish.resolve({ exitCode: 0 });
    await settled;
    tasks.takeDeliveries();

    expect(() => tasks.group({ ids: [running.id, delivered.id], reason: 'Mixed' })).toThrow(
      TaskError,
    );
    tasks.group({ ids: [running.id], reason: 'Retry' });
    expect(tasks.groupedPendingCount()).toBe(1);
  });

  it("reports a foreign session's grouped task as foreign, not by its group", () => {
    const tasks = new TaskRegistry();
    const owner = sessionIdSchema.parse('owner');
    const other = sessionIdSchema.parse('other');
    const { id } = tasks.start({
      command: 'a',
      description: 'A',
      sessionId: owner,
      run: async () => ({ exitCode: 0 }),
    });

    tasks.group({ ids: [id], reason: 'Mine', sessionId: owner });

    expect(() => tasks.group({ ids: [id], reason: 'Probe', sessionId: other })).toThrow(
      expect.objectContaining({ reason: 'task_not_owned', taskId: id }),
    );
  });

  it('still groups a running task and a task that finished but is not yet delivered', async () => {
    const tasks = new TaskRegistry();
    const finished = finishedTask(tasks);
    const running = finishedTask(tasks);
    const settled = tasks.nextSettled();

    finished.finish.resolve({ exitCode: 0 });
    await settled;

    expect(() => tasks.group({ ids: [finished.id, running.id], reason: 'Both' })).not.toThrow();
    expect(tasks.hasDeliveries()).toBe(false);

    const bothSettled = tasks.nextSettled();

    running.finish.resolve({ exitCode: 0 });
    await bothSettled;

    // The finished task's own notice was absorbed into the group: one delivery, both members.
    expect(tasks.takeDeliveries()).toEqual([
      { reason: 'Both', tasks: [tasks.get(finished.id), tasks.get(running.id)] },
    ]);
  });
});

describe('a finished task keeps its outcome', () => {
  // The work is done before the cancel arrives but settles a step later, so the abort signal is
  // already set when the registry records the result. The run's own success decides.
  it.each(['task', 'service'] as const)(
    'a %s cancelled after it finished is recorded as completed, silently',
    async (backgroundKind) => {
      const tasks = new TaskRegistry();
      const { id, finish } = finishedTask(tasks, backgroundKind);

      finish.resolve({ exitCode: 0, report: 'Done' });
      const cancelled = await tasks.cancel(id);

      expect(cancelled).toMatchObject({ status: 'completed', exitCode: 0 });
      expect(tasks.report(id)).toBe('Done');
      expect(tasks.hasDeliveries()).toBe(false);
    },
  );

  it('a run that ignores the abort and then exits 0 is recorded as completed', async () => {
    const tasks = new TaskRegistry();
    const { id, finish } = finishedTask(tasks);
    const cancelling = tasks.cancel(id);

    // The run does not stop on the abort: the cancel waits for it, and its own result decides.
    finish.resolve({ exitCode: 0 });

    expect((await cancelling)?.status).toBe('completed');
  });

  it.each([
    ['task', 'stops with no exit code', () => ({ exitCode: null })],
    ['task', 'stops with a failure code', () => ({ exitCode: 137 })],
    [
      'task',
      'rejects',
      () => {
        throw new Error('stopped');
      },
    ],
    ['service', 'stops with no exit code', () => ({ exitCode: null })],
    [
      'service',
      'rejects',
      () => {
        throw new Error('stopped');
      },
    ],
  ] as const)('a %s that %s when cancelled while running stays cancelled', async (kind, _, end) => {
    const tasks = new TaskRegistry();
    const { id } = tasks.start({
      command: 'work',
      description: 'Work',
      backgroundKind: kind,
      run: ({ signal }) =>
        new Promise((resolve) =>
          // Resolving with a promise adopts its rejection, so a throwing `end` rejects the run.
          signal.addEventListener(
            'abort',
            () => resolve(Promise.resolve().then<{ exitCode: number | null }>(end)),
            {
              once: true,
            },
          ),
        ),
    });

    expect((await tasks.cancel(id))?.status).toBe('cancelled');
  });

  it("reports a cancelled member and a finished one in the group's combined notice", async () => {
    const tasks = new TaskRegistry();
    const finished = finishedTask(tasks);
    const stopped = tasks.start({
      command: 'stop',
      description: 'Stop',
      run: ({ signal }) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () => resolve({ exitCode: null }), { once: true }),
        ),
    });

    tasks.group({ ids: [finished.id, stopped.id], reason: 'Both' });
    finished.finish.resolve({ exitCode: 0 });
    await tasks.cancel(stopped.id);

    expect(tasks.takeDeliveries()).toEqual([
      {
        reason: 'Both',
        tasks: [
          expect.objectContaining({ id: finished.id, status: 'completed' }),
          expect.objectContaining({ id: stopped.id, status: 'cancelled' }),
        ],
      },
    ]);
  });

  it('a grouped member cancelled after it finished is completed in the notice', async () => {
    const tasks = new TaskRegistry();
    const { id, finish } = finishedTask(tasks);

    tasks.group({ ids: [id], reason: 'One' });
    finish.resolve({ exitCode: 0 });
    await tasks.cancel(id);

    expect(tasks.takeDeliveries()[0]?.tasks[0]?.status).toBe('completed');
  });
});
