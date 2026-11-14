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
  it.fails('a task cancelled after it finished is recorded as completed', async () => {
    const tasks = new TaskRegistry();
    const { id, finish } = finishedTask(tasks);

    // The work is done before the cancel arrives but settles a step later, and the status is read
    // from the abort signal at settle time. Once settled, a cancel changes nothing (the loop suite
    // pins that).
    finish.resolve({ exitCode: 0 });
    const cancelled = await tasks.cancel(id);

    expect(cancelled?.status).toBe('completed');
  });
});
