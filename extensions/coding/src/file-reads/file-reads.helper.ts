import type { DocumentStore } from '@sheavly/core/store/store.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { SessionInfoView } from '@sheavly/runtime/sessions/session-scope.types';
import type { FileReads } from '@sheavly/workspace/file-reads/file-reads.service';
import {
  createFileReadsKeeper,
  restoreFileReads,
} from '@sheavly/workspace/file-reads/file-reads-store.helper';

/**
 * Restores what the main agent had read when this conversation was last open, and keeps it again
 * each time a prompt ends (the main session goes idle), so a reopened conversation does not read
 * the same files twice. Only the main agent's reads are kept: a sub-agent that was running comes
 * back interrupted and released. A failure to restore or keep goes to `onProblem` and the run goes
 * on, since a read only ever saves a `read_file`. Returns the function that stops keeping them:
 * call it when the conversation's extensions are deactivated.
 */
export async function keepReadsWithConversation(params: {
  fileReads: FileReads;
  sessions: Pick<SessionInfoView, 'onLifecycle'>;
  agentId: SessionId;
  store: DocumentStore;
  onProblem?: (caughtError: unknown) => void;
}): Promise<() => void> {
  const { fileReads, sessions, agentId, store, onProblem = () => undefined } = params;
  const keeper = createFileReadsKeeper({ fileReads, agentId, store });
  // A callback that throws must not become an unhandled rejection of its own.
  const report = (caughtError: unknown) => {
    try {
      onProblem(caughtError);
    } catch (caughtError_) {
      // Only the kind of failure: its message could quote a stored document, which holds file text.
      const kind = caughtError_ instanceof Error ? caughtError_.name : 'unknown';

      process.emitWarning(`Reporting a file reads problem failed (${kind}).`);
    }
  };

  try {
    await restoreFileReads({ fileReads, agentId, store });
  } catch (caughtError) {
    report(caughtError);
  }

  // What came back from the store is already there: the first prompt need not write it again.
  keeper.remember();

  return sessions.onLifecycle((update) => {
    if (update.type !== 'session_idle' || update.session.id !== agentId) return;

    keeper.keep().catch(report);
  });
}

/**
 * Forgets what a session was shown of the files once it is released: a released session is gone
 * for good, so its reads go with it, for the main agent and every sub-agent. Returns the function
 * that stops listening.
 */
export function forgetReleasedAgents(params: {
  fileReads: FileReads;
  sessions: Pick<SessionInfoView, 'onLifecycle'>;
}): () => void {
  const { fileReads, sessions } = params;

  return sessions.onLifecycle((update) => {
    if (update.type === 'session_released') fileReads.forgetAgent({ agentId: update.session.id });
  });
}
