import type { StoreError } from '@sheavly/core/errors/store.errors';
import { isMainSession } from '@sheavly/protocol/session/session.utils';
import type { SessionRegistry } from './sessions.service.js';

/**
 * Adds a `storage_failed` event to the stream under the main session, so a UI sees that the
 * conversation can no longer be kept. Does nothing before a main session exists. `error` names
 * the file or conversation, never what it holds. The event's own `seq` is 0: it belongs to no run.
 */
export function announceStorageFailure(params: {
  sessions: SessionRegistry;
  failure: StoreError;
}): void {
  const main = params.sessions.list().find(isMainSession);

  if (!main) return;

  params.sessions.publish({
    sessionId: main.id,
    event: { seq: 0, type: 'storage_failed', error: params.failure.message },
  });
}
