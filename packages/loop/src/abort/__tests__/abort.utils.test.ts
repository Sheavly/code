import { getEventListeners } from 'node:events';
import { describe, expect, it } from 'vitest';
import { raceAbort, untilAborted } from '../abort.utils.js';

/** A promise that counts every `then` made on it or on a promise derived from it. */
class CountingPromise<T> extends Promise<T> {
  static thens = 0;

  override then<A, B>(
    onFulfilled?: ((value: T) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    CountingPromise.thens += 1;

    return super.then(onFulfilled, onRejected);
  }
}

async function* numbers(count: number): AsyncGenerator<number> {
  for (let i = 0; i < count; i++) yield await Promise.resolve(i);
}

describe('untilAborted', () => {
  it('yields every item of a source that ends before the abort', async () => {
    const seen: number[] = [];

    for await (const n of untilAborted({
      source: numbers(4),
      aborted: new Promise<void>(() => undefined),
    })) {
      seen.push(n);
    }

    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it('stops at once on abort, without waiting for the next item', async () => {
    let abort: () => void = () => undefined;
    const aborted = new Promise<void>((resolve) => {
      abort = resolve;
    });
    const seen: number[] = [];
    const hanging = (async function* () {
      yield 1;
      await new Promise(() => undefined);
    })();

    for await (const n of untilAborted({ source: hanging, aborted })) {
      seen.push(n);
      abort();
    }

    expect(seen).toEqual([1]);
  });

  it('adds no handler to the abort promise per item', async () => {
    CountingPromise.thens = 0;

    const aborted = new CountingPromise<void>(() => undefined);

    let items = 0;

    for await (const _item of untilAborted({ source: numbers(200), aborted })) items++;

    expect(items).toBe(200);
    expect(CountingPromise.thens).toBeLessThanOrEqual(1);
  });
});

describe('raceAbort', () => {
  it('returns the work when it finishes first', async () => {
    const { signal } = new AbortController();

    await expect(raceAbort({ work: Promise.resolve('done'), signal })).resolves.toBe('done');
  });

  it('rejects with the work when it fails first', async () => {
    const { signal } = new AbortController();

    await expect(raceAbort({ work: Promise.reject(new Error('boom')), signal })).rejects.toThrow(
      'boom',
    );
  });

  it('returns undefined once the signal aborts, though the work never settles', async () => {
    const controller = new AbortController();
    const race = raceAbort({
      work: new Promise<string>(() => undefined),
      signal: controller.signal,
    });

    controller.abort();

    await expect(race).resolves.toBeUndefined();
  });

  it('returns undefined at once for a signal that is already aborted', async () => {
    const controller = new AbortController();

    controller.abort();

    await expect(
      raceAbort({ work: new Promise<string>(() => undefined), signal: controller.signal }),
    ).resolves.toBeUndefined();
  });

  it('handles a rejection that arrives after the abort, so it is never unhandled', async () => {
    const controller = new AbortController();
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    let fail: (error: Error) => void = () => undefined;
    const work = new Promise<string>((_resolve, reject) => {
      fail = reject;
    });

    process.on('unhandledRejection', record);

    try {
      const race = raceAbort({ work, signal: controller.signal });

      controller.abort();
      await race;
      fail(new Error('late'));
      // Unhandled rejections are reported on a later tick.
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      process.off('unhandledRejection', record);
    }

    expect(unhandled).toEqual([]);
  });

  it('leaves no abort listener behind once the work settles', async () => {
    const controller = new AbortController();

    for (let call = 0; call < 20; call += 1) {
      await raceAbort({ work: Promise.resolve(call), signal: controller.signal });
    }

    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });
});
