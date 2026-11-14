import { describe, expect, it } from 'vitest';
import { TaskRegistry } from '../tasks.service.js';

function startTask(params: { tasks: TaskRegistry; backgroundKind: 'task' | 'service' }): {
  finish: () => void;
  id: ReturnType<TaskRegistry['start']>['id'];
} {
  const done = Promise.withResolvers<{ exitCode: number }>();
  const info = params.tasks.start({
    command: 'work',
    description: 'Work',
    backgroundKind: params.backgroundKind,
    run: ({ signal }) => {
      signal.addEventListener('abort', () => done.resolve({ exitCode: 0 }), { once: true });

      return done.promise;
    },
  });

  return { id: info.id, finish: () => done.resolve({ exitCode: 0 }) };
}

describe('hasAwaitedTasks', () => {
  it('is false for ungrouped finite work and true only while grouped work runs', async () => {
    const tasks = new TaskRegistry();
    const { id, finish } = startTask({ tasks, backgroundKind: 'task' });

    expect(tasks.hasPendingTasks()).toBe(true);
    expect(tasks.hasAwaitedTasks()).toBe(false);

    tasks.group({ ids: [id], reason: 'Need it' });
    expect(tasks.hasAwaitedTasks()).toBe(true);

    const settled = tasks.nextSettled();

    finish();
    await settled;
    expect(tasks.hasAwaitedTasks()).toBe(false);
  });
});

describe('hasWakingDeliveries', () => {
  it.each([
    ['finite work', 'task', true],
    ['a service', 'service', false],
  ] as const)('is %s: %s', async (_name, backgroundKind, wakes) => {
    const tasks = new TaskRegistry();
    const { finish } = startTask({ tasks, backgroundKind });
    const settled = tasks.nextSettled();

    expect(tasks.hasWakingDeliveries()).toBe(false);
    finish();
    await settled;

    expect(tasks.hasDeliveries()).toBe(true);
    expect(tasks.hasWakingDeliveries()).toBe(wakes);
  });

  it('is false for a silent cancellation and once the delivery is taken', async () => {
    const tasks = new TaskRegistry();
    const cancelled = startTask({ tasks, backgroundKind: 'task' });

    await tasks.cancel(cancelled.id);
    expect(tasks.hasWakingDeliveries()).toBe(false);

    const { finish } = startTask({ tasks, backgroundKind: 'task' });
    const settled = tasks.nextSettled();

    finish();
    await settled;
    expect(tasks.hasWakingDeliveries()).toBe(true);
    tasks.takeDeliveries();
    expect(tasks.hasWakingDeliveries()).toBe(false);
  });

  it('stays false while a group still has running members', async () => {
    const tasks = new TaskRegistry();
    const first = startTask({ tasks, backgroundKind: 'task' });
    const second = startTask({ tasks, backgroundKind: 'task' });

    tasks.group({ ids: [first.id, second.id], reason: 'Both' });
    const settled = tasks.nextSettled();

    first.finish();
    await settled;
    expect(tasks.hasWakingDeliveries()).toBe(false);

    const last = tasks.nextSettled();

    second.finish();
    await last;
    expect(tasks.hasWakingDeliveries()).toBe(true);
  });
});
