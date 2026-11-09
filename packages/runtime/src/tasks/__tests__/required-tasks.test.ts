import { describe, expect, it } from 'vitest';
import { TaskRegistry } from '../tasks.service.js';

describe('required task completions', () => {
  it.each(['completed', 'failed', 'rejected'] as const)(
    'keeps a %s result required until it is delivered exactly once',
    async (outcome) => {
      const tasks = new TaskRegistry();
      const finish = Promise.withResolvers<{ exitCode: number }>();

      tasks.start({
        command: 'review',
        description: 'Review',
        waitForCompletion: true,
        run: () => finish.promise,
      });
      expect(tasks.hasRequiredTasks).toBe(true);
      const settled = tasks.nextSettled();

      if (outcome === 'rejected') finish.reject(new Error('review failed'));
      else finish.resolve({ exitCode: outcome === 'completed' ? 0 : 1 });
      await settled;
      expect(tasks.runningCount).toBe(0);
      expect(tasks.hasRequiredTasks).toBe(true);
      expect(tasks.takeUnreported()).toMatchObject([
        { status: outcome === 'completed' ? 'completed' : 'failed' },
      ]);
      expect(tasks.hasRequiredTasks).toBe(false);
      expect(tasks.takeUnreported()).toEqual([]);
    },
  );

  it('does not require a cancelled result or an ordinary running task', async () => {
    const tasks = new TaskRegistry();
    const required = tasks.start({
      command: 'review',
      description: 'Review',
      waitForCompletion: true,
      run: ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ exitCode: null }), { once: true });
        }),
    });

    tasks.start({
      command: 'server',
      description: 'Server',
      run: ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ exitCode: null }), { once: true });
        }),
    });
    await tasks.cancel(required.id);
    expect(tasks.hasRequiredTasks).toBe(false);
    expect(tasks.hasUnreported).toBe(false);
    expect(tasks.runningCount).toBe(1);
    await tasks.cancelAll();
  });
});
