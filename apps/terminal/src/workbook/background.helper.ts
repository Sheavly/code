import { setTimeout as sleep } from 'node:timers/promises';
import type { RemoteConversation } from '../client/conversation.service.js';
import { BackendError } from '../errors/backend.errors.js';
import {
  BACKGROUND_GRACE_MS,
  BACKGROUND_POLL_MS,
  BACKGROUND_WAIT_MS,
} from './workbook.constants.js';

/** What settling reads of a conversation: its background counts, and whether it runs. */
type Settling = {
  readonly background: RemoteConversation['background'];
  details(): Promise<{ running: boolean }>;
};

/**
 * Resolves once the conversation has no finite background work (commands, sub-agents) running and
 * no run of its own, for a short grace, or when `signal` aborts. Throws a `BackendError` when that
 * work still runs after `waitMs`: a run saved as completed with work cut off would fail a check
 * later with no hint of why. The prompt's `done` is not the end of a run: the backend ends it when
 * the model does, then wakes the idle conversation to deliver what finished, and that run's
 * entries must still be recorded. Services are left out: they never hold a run open. The caller
 * follows the live stream meanwhile.
 */
export async function settleBackground(params: {
  conversation: Settling;
  signal: AbortSignal;
  waitMs?: number;
}): Promise<void> {
  const { conversation, signal, waitMs = BACKGROUND_WAIT_MS } = params;
  const deadline = performance.now() + waitMs;

  while (!signal.aborted) {
    if (performance.now() >= deadline) throw stillRunning({ conversation, waitMs });

    if (!(await isSettled(conversation))) {
      await pause({ ms: BACKGROUND_POLL_MS, signal });
      continue;
    }

    // A task that just ended wakes the conversation a moment later, so look again before trusting it.
    await pause({ ms: BACKGROUND_GRACE_MS, signal });

    if (await isSettled(conversation)) return;
  }
}

async function isSettled(conversation: Settling): Promise<boolean> {
  const { tasks, agents } = conversation.background;

  return tasks + agents === 0 && !(await conversation.details()).running;
}

function stillRunning(params: { conversation: Settling; waitMs: number }): BackendError {
  const { tasks, agents } = params.conversation.background;

  return new BackendError({
    message: `Background work was still running ${String(params.waitMs)} ms after the prompt ended (${String(tasks)} commands, ${String(agents)} sub-agents)`,
  });
}

/** Waits `ms`, ending early without error when `signal` aborts. */
async function pause(params: { ms: number; signal: AbortSignal }): Promise<void> {
  try {
    await sleep(params.ms, undefined, { signal: params.signal });
  } catch (caughtError) {
    if (!params.signal.aborted) throw caughtError;
  }
}
