import { StoreError } from '@sheavly/core/errors/store.errors';
import type { EntryStore } from '@sheavly/core/store/store.types';
import type { SessionId, SessionInfo } from '@sheavly/protocol/session/session.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { ENTRY_TAIL_SIZE } from './sessions.constants.js';
import type { StoredLog } from './sessions.types.js';

/**
 * What a registry needs to carry on a conversation that was stored: where the numbering resumes,
 * the newest entries (kept in memory as a live log keeps them), and each session as its last
 * update left it, sub-agents included. Reads every entry once, in order; a gap means a write was
 * lost, so it throws a `StoreError` instead of resuming a conversation with a hole in it.
 */
export async function readStoredLog(store: EntryStore): Promise<StoredLog> {
  const tail: StreamEntry[] = [];
  const sessions = new Map<SessionId, SessionInfo>();
  let next = 0;

  for await (const entry of store.read()) {
    if (entry.seq !== next) {
      throw new StoreError({
        reason: 'failed',
        message: `Stored entries skip from ${String(next)} to ${String(entry.seq)}`,
      });
    }

    next++;
    tail.push(entry);
    if (tail.length > ENTRY_TAIL_SIZE) tail.shift();
    if (entry.kind === 'update') sessions.set(entry.update.session.id, entry.update.session);
  }

  return { next, tail, sessions: [...sessions.values()] };
}
