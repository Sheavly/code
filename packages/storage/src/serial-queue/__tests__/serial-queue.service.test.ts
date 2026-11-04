import { describe, expect, it } from 'vitest';
import { SerialQueue } from '../serial-queue.service.js';

const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('SerialQueue', () => {
  it('hands back what each task returns', async () => {
    const queue = new SerialQueue();

    expect(await queue.run(async () => 'a')).toBe('a');
    expect(await queue.run(async () => 42)).toBe(42);
  });

  it('runs tasks in the order they were given, one at a time, however long each takes', async () => {
    const queue = new SerialQueue();
    const events: string[] = [];
    let running = 0;
    let mostAtOnce = 0;
    const task = (name: string, ms: number) => async () => {
      running += 1;
      mostAtOnce = Math.max(mostAtOnce, running);
      events.push(`start ${name}`);
      await later(ms);
      events.push(`end ${name}`);
      running -= 1;
    };

    await Promise.all([
      queue.run(task('slow', 30)),
      queue.run(task('fast', 1)),
      queue.run(task('mid', 10)),
    ]);

    expect(mostAtOnce).toBe(1);
    expect(events).toEqual([
      'start slow',
      'end slow',
      'start fast',
      'end fast',
      'start mid',
      'end mid',
    ]);
  });

  it('gives a failure to the one who asked, and does not hold up the tasks after it', async () => {
    const queue = new SerialQueue();
    const failing = queue.run(async () => {
      throw new RangeError('no');
    });
    const after = queue.run(async () => 'still runs');

    await expect(failing).rejects.toThrow(RangeError);
    expect(await after).toBe('still runs');
  });

  it('does not let a failure escape as an unhandled rejection when its caller handles it', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);

    process.on('unhandledRejection', listener);

    try {
      const queue = new SerialQueue();

      await expect(queue.run(async () => Promise.reject(new RangeError('no')))).rejects.toThrow(
        RangeError,
      );
      await later(10);
    } finally {
      process.off('unhandledRejection', listener);
    }

    expect(unhandled).toEqual([]);
  });
});
