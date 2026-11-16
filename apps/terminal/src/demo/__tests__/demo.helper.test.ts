import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { closeSession, openSession } from '../../client/session.helper.js';
import { SAME_KEYPRESS_MS } from '../../render/render.constants.js';
import { runDemo } from '../demo.helper.js';

vi.mock('../../client/session.helper.js', () => ({ openSession: vi.fn(), closeSession: vi.fn() }));

const clock = useFixedClock();

/** A session whose prompt runs until its signal aborts, or never (`stubborn`). */
function fakeSession(params: { stubborn?: boolean; failure?: string } = {}) {
  const conversation = {
    runningTasks: 0,
    // A prompt that produces nothing until it is stopped; the empty `yield*` makes it a generator.
    async *send({ signal }: { signal: AbortSignal }) {
      yield* [];
      if (params.failure) throw new Error(params.failure);
      if (params.stubborn) await new Promise<never>(() => undefined);
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    },
  };

  return {
    backend: { stop: vi.fn(async () => undefined) },
    conversation,
    details: { session: 'main' },
    renderer: { entry: vi.fn() },
    prompt: 'hello',
  };
}

function demo() {
  const source = new EventEmitter();
  const exit = vi.fn<(code: number) => void>();
  const write = vi.fn<(text: string) => void>();
  const run = () => runDemo({ env: {}, args: [], write, source, exit });

  return { source, exit, write, run, press: () => source.emit('SIGINT') };
}

describe('runDemo', () => {
  it('stops the prompt on Ctrl+C, exits 130 and still ends the session', async () => {
    const session = fakeSession();
    const chat = demo();

    vi.mocked(openSession).mockResolvedValue(session as never);
    vi.mocked(closeSession).mockResolvedValue(undefined);

    const running = chat.run();

    await vi.waitFor(() => expect(openSession).toHaveBeenCalled());
    await vi.waitFor(() => expect(chat.source.listenerCount('SIGINT')).toBe(1));
    await new Promise((resolve) => setImmediate(resolve));
    chat.press();
    await expect(running).resolves.toBe(130);
    expect(closeSession).toHaveBeenCalledOnce();
    expect(chat.exit).not.toHaveBeenCalled();
    expect(chat.source.listenerCount('SIGINT')).toBe(0);
  });

  it('ignores the same keypress seen twice, then force-quits after the window: cleanup, exit 130', async () => {
    const session = fakeSession({ stubborn: true });
    const chat = demo();

    vi.mocked(openSession).mockResolvedValue(session as never);
    vi.mocked(closeSession).mockResolvedValue(undefined);
    void chat.run();
    await vi.waitFor(() => expect(openSession).toHaveBeenCalled());
    await new Promise((resolve) => setImmediate(resolve));
    chat.press();
    chat.press();
    expect(chat.write.mock.calls.filter(([text]) => text.includes('Stopping…'))).toHaveLength(1);
    clock.advance(SAME_KEYPRESS_MS);
    chat.press();
    await vi.waitFor(() => expect(chat.exit).toHaveBeenCalledWith(130));
    expect(closeSession).toHaveBeenCalledOnce();
  });

  it('exits 130 when Ctrl+C arrives while the backend starts', async () => {
    const chat = demo();

    vi.mocked(openSession).mockImplementation(
      ({ signal }) =>
        new Promise((_, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('interrupted')), { once: true });
        }),
    );

    const running = chat.run();

    chat.press();
    await expect(running).resolves.toBe(130);
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('ends the session even when the prompt fails, and reports exit code 1', async () => {
    const session = fakeSession({ failure: 'provider down' });
    const chat = demo();

    vi.mocked(openSession).mockResolvedValue(session as never);
    vi.mocked(closeSession).mockResolvedValue(undefined);
    await expect(chat.run()).resolves.toBe(1);
    expect(chat.write).toHaveBeenCalledWith('\n✗ Run failed: provider down\n');
    expect(closeSession).toHaveBeenCalledOnce();
  });
});
