import { describe, expect, it } from 'vitest';
import { withFileLock } from '../file-locks.service.js';

const signal = new AbortController().signal;

/** Queues a change on 'same' that records `name` in `order`, held until `gate` opens if given. */
const queue = (params: {
  name: string;
  order: string[];
  gate?: Promise<undefined>;
  abortWith?: AbortSignal;
}) =>
  withFileLock({
    file: 'same',
    signal: params.abortWith ?? signal,
    change: async () => {
      await params.gate;
      params.order.push(params.name);
    },
  });

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('withFileLock', () => {
  it('lets changes to different files run at the same time', async () => {
    const other = Promise.withResolvers<undefined>();
    const first = withFileLock({
      file: 'a',
      signal,
      change: async () => {
        await other.promise; // only the change on 'b' resolves this

        return 'a';
      },
    });
    const second = withFileLock({
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
    const failed = withFileLock({
      file: 'same',
      signal,
      change: () => Promise.reject(new Error('boom')),
    });
    const next = withFileLock({ file: 'same', signal, change: () => Promise.resolve('next') });

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
      withFileLock({ file: 'same', signal: AbortSignal.abort(new Error('gone')), change }),
    ).rejects.toThrow('gone');
  });
});
