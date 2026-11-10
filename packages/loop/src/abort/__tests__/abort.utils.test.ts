import { getEventListeners } from 'node:events';
import { describe, expect, it } from 'vitest';
import { raceAbort } from '../abort.utils.js';

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
