import { setTimeout as sleep } from 'node:timers/promises';
import type { RemoteConversation } from '../client/conversation.service.js';
import {
  BACKGROUND_GRACE_MS,
  BACKGROUND_POLL_MS,
  BACKGROUND_WAIT_MS,
} from './workbook.constants.js';

/**
 * Resolves once the conversation has no finite background work (commands, sub-agents) running and
 * no run of its own, for a short grace, or when `signal` aborts or `BACKGROUND_WAIT_MS` passes.
 * The prompt's `done` is not the end of a run: the backend ends it when the model does, then wakes
 * the idle conversation to deliver what finished, and that run's entries must still be recorded.
 * Services are left out: they never hold a run open. The caller follows the live stream meanwhile.
 */
export async function settleBackground(params: {
  conversation: RemoteConversation;
  signal: AbortSignal;
}): Promise<void> {
  const { conversation, signal } = params;
  const deadline = performance.now() + BACKGROUND_WAIT_MS;

  while (!signal.aborted && performance.now() < deadline) {
    if (!(await isSettled(conversation))) {
      await pause({ ms: BACKGROUND_POLL_MS, signal });
      continue;
    }

    // A task that just ended wakes the conversation a moment later, so look again before trusting it.
    await pause({ ms: BACKGROUND_GRACE_MS, signal });

    if (await isSettled(conversation)) return;
  }
}

async function isSettled(conversation: RemoteConversation): Promise<boolean> {
  const { tasks, agents } = conversation.background;

  return tasks + agents === 0 && !(await conversation.details()).running;
}

/** Waits `ms`, ending early without error when `signal` aborts. */
async function pause(params: { ms: number; signal: AbortSignal }): Promise<void> {
  try {
    await sleep(params.ms, undefined, { signal: params.signal });
  } catch (caughtError) {
    if (!params.signal.aborted) throw caughtError;
  }
}
