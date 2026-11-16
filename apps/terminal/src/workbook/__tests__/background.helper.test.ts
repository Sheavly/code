import { describe, expect, it } from 'vitest';
import { BackendError } from '../../errors/backend.errors.js';
import { settleBackground } from '../background.helper.js';

type Counts = { tasks: number; agents: number; services: number };

/** A conversation whose background work and running flag the test sets as it goes. */
function conversationWith(state: { background: Counts; running: boolean }) {
  return {
    get background() {
      return state.background;
    },
    details: () => Promise.resolve({ running: state.running }),
  };
}

const none: Counts = { tasks: 0, agents: 0, services: 0 };

describe('settleBackground', () => {
  it('resolves once nothing runs, after a grace that sees nothing new start', async () => {
    const state = { background: none, running: false };

    await expect(
      settleBackground({
        conversation: conversationWith(state),
        signal: new AbortController().signal,
      }),
    ).resolves.toBeUndefined();
  });

  it('does not count a service: it never holds a run open', async () => {
    const state = { background: { ...none, services: 2 }, running: false };

    await expect(
      settleBackground({
        conversation: conversationWith(state),
        signal: new AbortController().signal,
      }),
    ).resolves.toBeUndefined();
  });

  it('fails clearly when work still runs at the cap, naming what', async () => {
    const state = { background: { tasks: 1, agents: 2, services: 0 }, running: false };
    const failure: unknown = await settleBackground({
      conversation: conversationWith(state),
      signal: new AbortController().signal,
      waitMs: 300,
    }).catch((caughtError: unknown) => caughtError);

    expect(failure).toBeInstanceOf(BackendError);
    expect((failure as Error).message).toContain('1 commands, 2 sub-agents');
  });

  it('fails at the cap while the conversation itself is still running', async () => {
    const state = { background: none, running: true };

    await expect(
      settleBackground({
        conversation: conversationWith(state),
        signal: new AbortController().signal,
        waitMs: 300,
      }),
    ).rejects.toBeInstanceOf(BackendError);
  });

  it('returns without error when the signal aborts, leaving the caller to say why', async () => {
    const state = { background: { tasks: 1, agents: 0, services: 0 }, running: false };
    const controller = new AbortController();
    const settling = settleBackground({
      conversation: conversationWith(state),
      signal: controller.signal,
    });

    controller.abort();

    await expect(settling).resolves.toBeUndefined();
  });
});
