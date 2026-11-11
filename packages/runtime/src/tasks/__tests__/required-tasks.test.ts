import { describe, expect, it } from 'vitest';
import { TaskRegistry } from '../tasks.service.js';

describe('finite task completions', () => {
  it.each(['completed', 'failed', 'rejected'] as const)(
    'keeps a %s result pending until it is delivered exactly once',
    async (outcome) => {
      const tasks = new TaskRegistry();
      const finish = Promise.withResolvers<{ exitCode: number }>();

      tasks.start({
        command: 'review',
        description: 'Review',
        backgroundKind: 'task',
        run: () => finish.promise,
      });
      expect(tasks.hasPendingTasks()).toBe(true);
      const settled = tasks.nextSettled();

      if (outcome === 'rejected') finish.reject(new Error('review failed'));
      else finish.resolve({ exitCode: outcome === 'completed' ? 0 : 1 });
      await settled;
      expect(tasks.runningCount).toBe(0);
      expect(tasks.hasPendingTasks()).toBe(true);
      expect(tasks.takeDeliveries()).toMatchObject([
        { tasks: [{ status: outcome === 'completed' ? 'completed' : 'failed' }] },
      ]);
      expect(tasks.hasPendingTasks()).toBe(false);
      expect(tasks.takeDeliveries()).toEqual([]);
    },
  );

  it('does not keep silent cancellations or a running service pending', async () => {
    const tasks = new TaskRegistry();
    const finite = tasks.start({
      command: 'review',
      description: 'Review',
      backgroundKind: 'task',
      run: ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ exitCode: null }), { once: true });
        }),
    });

    tasks.start({
      command: 'server',
      description: 'Server',
      backgroundKind: 'service',
      run: ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ exitCode: null }), { once: true });
        }),
    });
    await tasks.cancel(finite.id);
    expect(tasks.hasPendingTasks()).toBe(false);
    expect(tasks.hasDeliveries()).toBe(false);
    expect(tasks.runningCount).toBe(1);
    await tasks.cancelAll();
  });
});
