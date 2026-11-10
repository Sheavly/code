import { describe, expect, it } from 'vitest';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import { TaskRegistry } from '../tasks.service.js';

function startTask(params: { tasks: TaskRegistry; run: () => Promise<{ exitCode: number }> }) {
  return params.tasks.start({ command: 'cmd', description: 'work', run: params.run });
}

describe('releasing tasks', () => {
  it('forgets a finished task once it has been reported, with its output', async () => {
    const tasks = new TaskRegistry();
    const { id } = startTask({ tasks, run: () => Promise.resolve({ exitCode: 0 }) });

    await tasks.nextSettled();
    tasks.takeUnreported();

    expect(tasks.release(id)).toBe(true);
    expect(tasks.get(id)).toBeUndefined();
    expect(tasks.list()).toEqual([]);
  });

  it('keeps a task the model has not been told about, and one still running', async () => {
    const tasks = new TaskRegistry();
    const finished = startTask({ tasks, run: () => Promise.resolve({ exitCode: 0 }) });
    const running = startTask({ tasks, run: () => new Promise(() => undefined) });

    await tasks.nextSettled();

    expect(tasks.release(finished.id)).toBe(false);
    expect(tasks.release(running.id)).toBe(false);
    expect(tasks.list()).toHaveLength(2);
  });

  it('releases every finished, reported task at once, and none it must keep', async () => {
    const tasks = new TaskRegistry();
    const done = startTask({ tasks, run: () => Promise.resolve({ exitCode: 1 }) });
    const running = startTask({ tasks, run: () => new Promise(() => undefined) });

    await tasks.nextSettled();
    tasks.takeUnreported();

    expect(tasks.releaseFinished()).toBe(1);
    expect(tasks.get(done.id)).toBeUndefined();
    expect(tasks.get(running.id)?.status).toBe('running');
  });

  it('releases a task cancelled on request, which is never reported', async () => {
    const tasks = new TaskRegistry();
    const { id } = tasks.start({
      command: 'cmd',
      description: 'work',
      run: ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ exitCode: null }));
        }),
    });

    await tasks.cancel(id);

    expect(tasks.hasUnreported).toBe(false);
    expect(tasks.release(id)).toBe(true);
    expect(tasks.get(id)).toBeUndefined();
  });

  it('refuses an unknown id', () => {
    expect(new TaskRegistry().release(taskIdSchema.parse('t99'))).toBe(false);
  });
});
