import { describe, expect, it, vi } from 'vitest';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { TaskError } from '../../errors/tasks.errors.js';
import { TaskRegistry } from '../tasks.service.js';
import type { TaskObserver } from '../tasks.types.js';

const clock = useFixedClock();

function controlledTask(tasks: TaskRegistry) {
  const result = Promise.withResolvers<{ exitCode: number | null }>();
  const info = tasks.start({
    command: 'check',
    description: 'Check',
    run: ({ signal }) => {
      signal.addEventListener('abort', () => result.resolve({ exitCode: null }), { once: true });

      return result.promise;
    },
  });

  return {
    info,
    finish: async (exitCode = 0) => {
      const settled = tasks.nextSettled();

      result.resolve({ exitCode });
      await settled;
    },
  };
}

describe('task group deliveries', () => {
  it('wakes parked task waiters when registering an already-settled group', async () => {
    const tasks = new TaskRegistry();
    const completed = controlledTask(tasks);

    await completed.finish();
    tasks.takeDeliveries();
    const wake = tasks.nextSettled();

    expect(tasks.settleWaiters).toBe(1);
    tasks.group({ ids: [completed.info.id], reason: 'Revisit completed work' });
    expect(tasks.settleWaiters).toBe(0);
    await wake;
    expect(tasks.takeDeliveries()).toHaveLength(1);
    expect(tasks.takeDeliveries()).toEqual([]);
  });

  it('publishes every task start and end immediately while member notices stay held', async () => {
    const tasks = new TaskRegistry();
    const observer = vi.fn<TaskObserver>();

    tasks.observe(observer);
    const first = controlledTask(tasks);
    const last = controlledTask(tasks);

    tasks.group({ ids: [first.info.id, last.info.id], reason: 'Read both' });
    await first.finish();
    expect(observer.mock.calls.map(([event]) => event.update.type)).toEqual([
      'task_started',
      'task_started',
      'task_ended',
    ]);
    expect(tasks.hasDeliveries()).toBe(false);
    await last.finish();
    expect(observer.mock.calls.map(([event]) => event.update.task.id)).toEqual([
      first.info.id,
      last.info.id,
      first.info.id,
      last.info.id,
    ]);
    expect(tasks.hasDeliveries()).toBe(true);
  });

  it('holds individual completions until every member settles, in requested ID order', async () => {
    const tasks = new TaskRegistry();
    const first = controlledTask(tasks);
    const second = controlledTask(tasks);

    const group = vi.spyOn(tasks, 'group');

    tasks.group({ ids: [second.info.id, first.info.id], reason: 'Compare checks' });

    expect(group).toHaveReturnedWith(undefined);
    await first.finish();

    expect(tasks.hasDeliveries()).toBe(false);
    expect(tasks.takeDeliveries()).toEqual([]);
    expect(tasks.hasPendingTasks()).toBe(true);
    expect(tasks.release(first.info.id)).toBe(false);

    await second.finish(1);

    expect(tasks.hasDeliveries()).toBe(true);
    expect(tasks.takeDeliveries()).toEqual([
      {
        reason: 'Compare checks',
        tasks: [tasks.get(second.info.id), tasks.get(first.info.id)],
      },
    ]);
    expect(tasks.hasDeliveries()).toBe(false);
    expect(tasks.hasPendingTasks()).toBe(false);
    expect(tasks.takeDeliveries()).toEqual([]);
  });

  it('absorbs a queued single completion when it is grouped with running work', async () => {
    const tasks = new TaskRegistry();
    const finished = controlledTask(tasks);
    const running = controlledTask(tasks);

    await finished.finish();
    expect(tasks.hasDeliveries()).toBe(true);

    tasks.group({ ids: [finished.info.id, running.info.id], reason: 'Combined result' });

    expect(tasks.hasDeliveries()).toBe(false);
    expect(tasks.takeDeliveries()).toEqual([]);
    expect(tasks.release(finished.info.id)).toBe(false);

    await running.finish();

    expect(tasks.takeDeliveries()).toEqual([
      {
        reason: 'Combined result',
        tasks: [tasks.get(finished.info.id), tasks.get(running.info.id)],
      },
    ]);
  });

  it('orders ready groups and singles by the last settlement, not group creation', async () => {
    const tasks = new TaskRegistry();
    const first = controlledTask(tasks);
    const last = controlledTask(tasks);
    const single = controlledTask(tasks);
    const laterGroup = controlledTask(tasks);

    tasks.group({ ids: [first.info.id, last.info.id], reason: 'Started first' });
    tasks.group({ ids: [laterGroup.info.id], reason: 'Ready first' });
    await first.finish();
    clock.advance(10);
    await laterGroup.finish();
    clock.advance(10);
    await single.finish();
    clock.advance(10);
    await last.finish();

    expect(tasks.takeDeliveries()).toEqual([
      { reason: 'Ready first', tasks: [tasks.get(laterGroup.info.id)] },
      { tasks: [tasks.get(single.info.id)] },
      { reason: 'Started first', tasks: [tasks.get(first.info.id), tasks.get(last.info.id)] },
    ]);
  });

  it('uses ready time when already-settled members are grouped after another delivery', async () => {
    const tasks = new TaskRegistry();
    const first = controlledTask(tasks);
    const second = controlledTask(tasks);
    const single = controlledTask(tasks);

    await first.finish();
    clock.advance(10);
    await second.finish();
    clock.advance(10);
    await single.finish();
    clock.advance(10);
    tasks.group({ ids: [second.info.id, first.info.id], reason: 'Ready now' });

    expect(tasks.takeDeliveries()).toEqual([
      { tasks: [tasks.get(single.info.id)] },
      { reason: 'Ready now', tasks: [tasks.get(second.info.id), tasks.get(first.info.id)] },
    ]);
  });

  it('includes a cancelled member in its group while standalone cancellations stay silent', async () => {
    const tasks = new TaskRegistry();
    const cancelled = controlledTask(tasks);
    const finished = controlledTask(tasks);
    const silentSingle = controlledTask(tasks);

    tasks.group({ ids: [cancelled.info.id, finished.info.id], reason: 'All outcomes' });
    await tasks.cancel(cancelled.info.id);
    await tasks.cancel(silentSingle.info.id);

    expect(tasks.hasDeliveries()).toBe(false);
    expect(tasks.release(cancelled.info.id)).toBe(false);
    expect(tasks.release(silentSingle.info.id)).toBe(true);

    await finished.finish();

    expect(tasks.release(cancelled.info.id)).toBe(false);
    expect(tasks.release(finished.info.id)).toBe(false);
    expect(tasks.takeDeliveries()).toEqual([
      {
        reason: 'All outcomes',
        tasks: [tasks.get(cancelled.info.id), tasks.get(finished.info.id)],
      },
    ]);
    expect(tasks.get(cancelled.info.id)?.status).toBe('cancelled');
    expect(tasks.release(cancelled.info.id)).toBe(true);
    expect(tasks.release(finished.info.id)).toBe(true);
  });

  it('absorbs a cancellation settled before grouping rather than silently releasing it', async () => {
    const tasks = new TaskRegistry();
    const cancelled = controlledTask(tasks);
    const running = controlledTask(tasks);

    await tasks.cancel(cancelled.info.id);
    tasks.group({ ids: [running.info.id, cancelled.info.id], reason: 'Include cancellation' });

    expect(tasks.release(cancelled.info.id)).toBe(false);
    expect(tasks.releaseFinished()).toBe(0);

    await running.finish();

    expect(tasks.takeDeliveries()).toEqual([
      {
        reason: 'Include cancellation',
        tasks: [tasks.get(running.info.id), tasks.get(cancelled.info.id)],
      },
    ]);
  });
});

describe('atomic task group validation', () => {
  it('rejects an empty group synchronously without consuming a queued delivery', async () => {
    const tasks = new TaskRegistry();
    const completed = controlledTask(tasks);

    await completed.finish();

    const request = () => tasks.group({ ids: [], reason: 'No members' });

    expect(request).toThrow(TaskError);
    expect(request).toThrow(expect.objectContaining({ reason: 'empty_group' }));
    expect(tasks.hasDeliveries()).toBe(true);
    expect(tasks.hasPendingTasks()).toBe(true);
    expect(tasks.takeDeliveries()).toEqual([{ tasks: [tasks.get(completed.info.id)] }]);
  });

  it.each(['unknown_task', 'duplicate_task'] as const)(
    'rejects %s synchronously without consuming a queued completion or grouping valid IDs',
    async (reason) => {
      const tasks = new TaskRegistry();
      const first = controlledTask(tasks);
      const second = controlledTask(tasks);

      await first.finish();

      const invalid = reason === 'unknown_task' ? taskIdSchema.parse('t999') : first.info.id;
      const request = () =>
        tasks.group({ ids: [first.info.id, second.info.id, invalid], reason: 'Invalid' });

      expect(request).toThrow(TaskError);
      expect(request).toThrow(expect.objectContaining({ reason }));
      expect(tasks.takeDeliveries()).toEqual([{ tasks: [tasks.get(first.info.id)] }]);
      tasks.group({ ids: [first.info.id, second.info.id], reason: 'Valid retry' });

      await second.finish();

      expect(tasks.takeDeliveries()).toEqual([
        { reason: 'Valid retry', tasks: [tasks.get(first.info.id), tasks.get(second.info.id)] },
      ]);
    },
  );

  it('rejects an already-grouped member without disturbing its group or the new members', async () => {
    const tasks = new TaskRegistry();
    const member = controlledTask(tasks);
    const newMember = controlledTask(tasks);

    tasks.group({ ids: [member.info.id], reason: 'Original' });

    expect(() =>
      tasks.group({ ids: [newMember.info.id, member.info.id], reason: 'Invalid' }),
    ).toThrow(TaskError);
    expect(() =>
      tasks.group({ ids: [newMember.info.id, member.info.id], reason: 'Invalid' }),
    ).toThrow(expect.objectContaining({ reason: 'task_grouped' }));
    await newMember.finish();

    expect(tasks.takeDeliveries()).toEqual([{ tasks: [tasks.get(newMember.info.id)] }]);

    await member.finish();

    expect(tasks.takeDeliveries()).toEqual([
      { reason: 'Original', tasks: [tasks.get(member.info.id)] },
    ]);
  });

  it('retains membership after delivery and partial release until each member is released', async () => {
    const tasks = new TaskRegistry();
    const first = controlledTask(tasks);
    const second = controlledTask(tasks);
    const outside = controlledTask(tasks);

    tasks.group({ ids: [first.info.id, second.info.id], reason: 'Keep membership' });
    await first.finish();
    await second.finish();

    expect(tasks.releaseFinished()).toBe(0);
    tasks.takeDeliveries();

    expect(() => tasks.group({ ids: [outside.info.id, first.info.id], reason: 'Again' })).toThrow(
      TaskError,
    );
    expect(tasks.release(first.info.id)).toBe(true);
    expect(tasks.get(first.info.id)).toBeUndefined();
    expect(() => tasks.group({ ids: [outside.info.id, second.info.id], reason: 'Again' })).toThrow(
      expect.objectContaining({ reason: 'task_grouped' }),
    );
    expect(tasks.release(second.info.id)).toBe(true);

    tasks.group({ ids: [outside.info.id], reason: 'Unchanged outsider' });
    await outside.finish();

    expect(tasks.takeDeliveries()).toEqual([
      { reason: 'Unchanged outsider', tasks: [tasks.get(outside.info.id)] },
    ]);
    expect(tasks.releaseFinished()).toBe(1);
  });
});
