import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { FileReads } from '@sheavly/workspace/file-reads/file-reads.service';
import {
  createFileReadsKeeper,
  restoreFileReads,
} from '@sheavly/workspace/file-reads/file-reads-store.helper';
import type { WorkingRootStore } from '@sheavly/workspace/working-root/working-root.types';

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
  sessions: SessionRegistry;
  agentId: SessionId;
  store: WorkingRootStore;
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

  return sessions.subscribe((update) => {
    if (update.type !== 'session_idle' || update.session.id !== agentId) return;

    keeper.keep().catch(report);
  });
}
