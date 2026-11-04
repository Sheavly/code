import { StoreError } from '@sheavly/core/errors/store.errors';
import type { EntryStore } from '@sheavly/core/store/store.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { deepFreeze } from './listeners.helper.js';

/** A storage error as a `StoreError`: one a store already raised is kept, any other is wrapped. */
export function toStoreError(params: { error: unknown; message: string }): StoreError {
  const { error, message } = params;

  return error instanceof StoreError
    ? error
    : new StoreError({ reason: 'failed', message, cause: error });
}

/**
 * Hands `deliver` each stored entry below `upTo` that `matches`, in order. It waits for
 * `written` first, so the entries a log has queued for the store are in it. Stored entries must
 * run 0, 1, 2, ... up to `upTo`: a gap means a write was lost, and replaying around it would
 * show a conversation that never happened, so it throws a `StoreError` instead. Stops quietly
 * once `stopped` says the listener left.
 */
export async function replayStored(params: {
  store: EntryStore;
  written: Promise<void>;
  upTo: number;
  matches: (entry: StreamEntry) => boolean;
  deliver: (entry: StreamEntry) => void;
  stopped: () => boolean;
}): Promise<void> {
  const { store, written, upTo, matches, deliver, stopped } = params;
  let expected = 0;

  await written;

  for await (const entry of store.read()) {
    if (stopped() || entry.seq >= upTo) break;

    if (entry.seq !== expected) {
      throw new StoreError({
        reason: 'failed',
        message: `Stored entries skip from ${String(expected)} to ${String(entry.seq)}`,
      });
    }

    expected++;
    if (matches(entry)) deliver(deepFreeze(entry));
  }

  if (!stopped() && expected < upTo) {
    throw new StoreError({
      reason: 'failed',
      message: `Stored entries end at ${String(expected)}, before ${String(upTo)}: some were never written`,
    });
  }
}
