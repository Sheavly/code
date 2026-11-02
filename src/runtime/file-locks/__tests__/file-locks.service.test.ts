import { beforeEach, describe, expect, it } from 'vitest';
import { FileLocks } from '../file-locks.service.js';

/** A fresh set of locks per test, so no queue leaks from one test into the next. */
let locks: FileLocks;

beforeEach(() => {
  locks = new FileLocks();
});

const signal = new AbortController().signal;

/** Queues a change on 'same' that records `name` in `order`, held until `gate` opens if given. */
const queue = (params: {
  name: string;
  order: string[];
  gate?: Promise<undefined>;
  abortWith?: AbortSignal;
}) =>
  locks.run({
    file: 'same',
    signal: params.abortWith ?? signal,
    change: async () => {
      await params.gate;
      params.order.push(params.name);
    },
  });

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('FileLocks', () => {
  it('lets changes to different files run at the same time', async () => {
    const other = Promise.withResolvers<undefined>();
    const first = locks.run({
      file: 'a',
      signal,
      change: async () => {
        await other.promise; // only the change on 'b' resolves this

        return 'a';
      },
    });
    const second = locks.run({
      file: 'b',
      signal,
      change: () => {
        other.resolve(undefined);

        return Promise.resolve('b');
      },
    });

    expect(await Promise.all([first, second])).toEqual(['a', 'b']);
  });

  it('starts a change only after the earlier one on the same file finished', async () => {
    const order: string[] = [];
    const gate = Promise.withResolvers<undefined>();
    const first = queue({ name: 'first', order, gate: gate.promise });
    const second = queue({ name: 'second', order });

    await settle();
    expect(order).toEqual([]);

    gate.resolve(undefined);
    await Promise.all([first, second]);

    expect(order).toEqual(['first', 'second']);
  });

  it('releases the file when a change throws', async () => {
    const failed = locks.run({
      file: 'same',
      signal,
      change: () => Promise.reject(new Error('boom')),
    });
    const next = locks.run({ file: 'same', signal, change: () => Promise.resolve('next') });

    await expect(failed).rejects.toThrow('boom');
    expect(await next).toBe('next');
  });

  it('gives up waiting on abort, without letting earlier or later changes skip the running one', async () => {
    const order: string[] = [];
    const gate = Promise.withResolvers<undefined>();
    const controller = new AbortController();
    const running = queue({ name: 'running', order, gate: gate.promise });
    const aborted = queue({ name: 'aborted', order, abortWith: controller.signal });
    const queuedBefore = queue({ name: 'before abort', order });

    controller.abort(new Error('stopped'));
    await expect(aborted).rejects.toThrow('stopped');

    const queuedAfter = queue({ name: 'after abort', order });

    await settle();
    expect(order).toEqual([]);

    gate.resolve(undefined);
    await Promise.all([running, queuedBefore, queuedAfter]);

    expect(order).toEqual(['running', 'before abort', 'after abort']);
  });

  it('keeps the file locked when the last waiter aborts', async () => {
    const order: string[] = [];
    const gate = Promise.withResolvers<undefined>();
    const running = queue({ name: 'running', order, gate: gate.promise });
    const gone = AbortSignal.abort(new Error('gone'));

    await expect(queue({ name: 'aborted', order, abortWith: gone })).rejects.toThrow('gone');

    const next = queue({ name: 'next', order });

    await settle();
    expect(order).toEqual([]);

    gate.resolve(undefined);
    await Promise.all([running, next]);

    expect(order).toEqual(['running', 'next']);
  });

  it('refuses to wait when the signal is already aborted', async () => {
    const change = () => Promise.resolve('ran');

    await expect(
      locks.run({ file: 'same', signal: AbortSignal.abort(new Error('gone')), change }),
    ).rejects.toThrow('gone');
  });

  it('keeps each instance separate: another set of locks never waits on this one', async () => {
    const gate = Promise.withResolvers<undefined>();
    const held = locks.run({ file: 'same', signal, change: () => gate.promise });
    const other = new FileLocks();

    await expect(
      other.run({ file: 'same', signal, change: () => Promise.resolve('free') }),
    ).resolves.toBe('free');

    gate.resolve(undefined);
    await held;
  });

  it('forgets a file once every change on it has settled', async () => {
    const gate = Promise.withResolvers<undefined>();
    const running = locks.run({ file: 'same', signal, change: () => gate.promise });

    expect(locks.busy).toBe(1);

    gate.resolve(undefined);
    await running;
    await settle();

    expect(locks.busy).toBe(0);
  });
});
