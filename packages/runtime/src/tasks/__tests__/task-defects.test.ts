import { describe, expect, it } from 'vitest';
import { TaskRegistry } from '../tasks.service.js';

// Each `it.fails` states the rule and breaks on today's code: it turns red when the defect is
// fixed, and the fixing change flips it to `it`. See "The flow that must hold" in
// `.agents/skills/sheavly/state-machines.md`.

function finishedTask(tasks: TaskRegistry) {
  const finish = Promise.withResolvers<{ exitCode: number }>();
  const info = tasks.start({
    command: 'review',
    description: 'Review',
    backgroundKind: 'task',
    run: () => finish.promise,
  });

  return { id: info.id, finish };
}

describe('finished work reaches the model once', () => {
  it.fails(
    'rule 5: grouping a task whose notice was already delivered does not notify again',
    async () => {
      const tasks = new TaskRegistry();
      const { id, finish } = finishedTask(tasks);
      const settled = tasks.nextSettled();

      finish.resolve({ exitCode: 0 });
      await settled;
      expect(tasks.takeDeliveries()).toHaveLength(1);

      // Refusing the late group is as good as not notifying again: either way nothing is queued.
      const grouping = () => tasks.group({ ids: [id], reason: 'Too late' });

      expect(grouping).toThrow();
      expect(tasks.hasDeliveries()).toBe(false);
    },
  );
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
