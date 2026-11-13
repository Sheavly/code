import { getEventListeners } from 'node:events';
import { describe, expect, it } from 'vitest';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import { TaskRegistry } from '../tasks.service.js';

function startTask(params: { tasks: TaskRegistry; run: () => Promise<{ exitCode: number }> }) {
  return params.tasks.start({ command: 'cmd', description: 'work', run: params.run });
}

describe('waiting for a task to finish', () => {
  it('drops a wait whose signal aborts', async () => {
    const tasks = new TaskRegistry();
    const controller = new AbortController();
    const wait = tasks.nextSettled(controller.signal);

    expect(tasks.settleWaiters).toBe(1);

    controller.abort();
    await wait;

    expect(tasks.settleWaiters).toBe(0);
  });
});

describe('a task wait on a long-lived signal', () => {
  it('leaves no abort listener once a task settles, and ignores a signal already aborted', async () => {
    const tasks = new TaskRegistry();
    const signal = new AbortController().signal;

    for (let i = 0; i < 5; i++) {
      const wait = tasks.nextSettled(signal);

      startTask({ tasks, run: () => Promise.resolve({ exitCode: 0 }) });
      await wait;
    }

    expect(getEventListeners(signal, 'abort')).toHaveLength(0);

    await tasks.nextSettled(AbortSignal.abort());

    expect(tasks.settleWaiters).toBe(0);
  });
});

/** A task that finished and whose notice was taken: the state `release` accepts. */
async function reportedTask(tasks: TaskRegistry) {
  const { id } = startTask({ tasks, run: () => Promise.resolve({ exitCode: 0 }) });

  await tasks.nextSettled();
  tasks.takeUnreported();

  return id;
}

describe('releasing tasks', () => {
  it('forgets a finished task once it has been reported, with its output', async () => {
    const tasks = new TaskRegistry();
    const id = await reportedTask(tasks);

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

  it('releases only the tasks a session owns, or that have no owner', async () => {
    const tasks = new TaskRegistry();
    const mine = sessionIdSchema.parse('mine');
    const theirs = sessionIdSchema.parse('theirs');
    const run = () => Promise.resolve({ exitCode: 0 });
    const own = tasks.start({ command: 'a', description: 'a', sessionId: mine, run });
    const foreign = tasks.start({ command: 'b', description: 'b', sessionId: theirs, run });
    const generic = tasks.start({ command: 'c', description: 'c', run });

    await tasks.nextSettled();
    tasks.takeUnreported();

    expect(tasks.releaseFinished(mine)).toBe(2);
    expect(tasks.get(own.id)).toBeUndefined();
    expect(tasks.get(generic.id)).toBeUndefined();
    expect(tasks.get(foreign.id)?.status).toBe('completed');
  });
});

describe('telling a released task from one that never existed', () => {
  it('knows an id it handed out and released, never one it did not', async () => {
    const tasks = new TaskRegistry();
    const id = await reportedTask(tasks);

    expect(tasks.isReleased(id)).toBe(false);

    tasks.release(id);

    expect(tasks.isReleased(id)).toBe(true);
    expect(tasks.isReleased(taskIdSchema.parse('t99'))).toBe(false);
  });

  it.each(['t0', 't', 't01', 'x1', 't-1', 't1x', 'tNaN'])(
    'never calls %s released: it is not an id the registry hands out',
    async (malformed) => {
      const tasks = new TaskRegistry();
      const id = await reportedTask(tasks);

      tasks.release(id);

      expect(tasks.isReleased(taskIdSchema.parse(malformed))).toBe(false);
    },
  );

  it('refuses to group a released task with its own reason', async () => {
    const tasks = new TaskRegistry();
    const id = await reportedTask(tasks);

    tasks.release(id);

    expect(() => tasks.group({ ids: [id], reason: 'again' })).toThrow(
      expect.objectContaining({ reason: 'task_released' }),
    );
  });
});
