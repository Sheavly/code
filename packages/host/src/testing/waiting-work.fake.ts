import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { WorkDefinition } from '@sheavly/runtime/tasks/work.types';
import { finiteWork } from '@sheavly/runtime/tasks/work.utils';

/** Test-only: finite work for `sessionId` that runs until it is cancelled, then exits with 1. */
export function waitingWork(sessionId: SessionId): WorkDefinition {
  return finiteWork({
    command: 'wait',
    description: 'waits',
    sessionId,
    run: ({ signal }) =>
      new Promise((resolve) => signal.addEventListener('abort', () => resolve({ exitCode: 1 }))),
  });
}
