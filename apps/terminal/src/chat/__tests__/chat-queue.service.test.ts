import { describe, expect, it, vi } from 'vitest';
import { ChatQueue } from '../chat-queue.service.js';

function queue(...lines: string[]) {
  const changed = vi.fn();
  const pending = new ChatQueue(changed);

  for (const line of lines) pending.push(line);

  return { pending, changed, signal: new AbortController().signal };
}

describe('ChatQueue: live follow-ups', () => {
  it('forwards text in order but does not bypass a queued command', async () => {
    const { pending, signal } = queue('one', 'two', '/model Deep', 'three');
    const send = vi.fn(async () => true);

    pending.forward({ signal, send, onError: vi.fn() });

    expect(await pending.take()).toBe('/model Deep');
    expect(send.mock.calls).toEqual([
      ['one', expect.any(AbortSignal)],
      ['two', expect.any(AbortSignal)],
    ]);
    expect(pending.queued).toEqual(['three']);
  });

  it('keeps a refused follow-up for the next prompt and does not keep retrying the old run', async () => {
    const { pending, signal } = queue('follow up');
    const send = vi.fn(async () => false);

    pending.forward({ signal, send, onError: vi.fn() });
    await Promise.resolve();
    await Promise.resolve();
    pending.forward({ signal, send, onError: vi.fn() });

    expect(await pending.take()).toBe('follow up');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not start a second prompt while the first acceptance response is in flight', async () => {
    const { pending, signal } = queue('follow up');
    const response = Promise.withResolvers<boolean>();
    const send = vi.fn(() => response.promise);
    let took = false;

    pending.forward({ signal, send, onError: vi.fn() });
    const taking = pending.take().then((line) => {
      took = true;

      return line;
    });

    await Promise.resolve();
    expect(took).toBe(false);
    response.resolve(true);
    expect(await taking).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reports an ambiguous transport failure without replaying potentially accepted text', async () => {
    const { pending, signal } = queue('follow up');
    const failure = new Error('connection lost after acceptance');
    const onError = vi.fn();

    pending.forward({
      signal,
      send: async () => {
        throw failure;
      },
      onError,
    });

    expect(await pending.take()).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('keeps input queued while stopping and stops forwarding later messages after an abort', async () => {
    const { pending } = queue('first', 'second');
    const stop = new AbortController();
    const send = vi.fn(async () => {
      stop.abort();

      return true;
    });

    pending.forward({ signal: stop.signal, send, onError: vi.fn() });

    expect(await pending.take()).toBe('second');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not remove a new queued message when input is dropped during an in-flight response', async () => {
    const { pending, signal } = queue('old');
    const response = Promise.withResolvers<boolean>();

    pending.forward({ signal, send: () => response.promise, onError: vi.fn() });
    pending.drop();
    pending.push('new');
    response.resolve(true);

    expect(await pending.take()).toBe('new');
  });
});
