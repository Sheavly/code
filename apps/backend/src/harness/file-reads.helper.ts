import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { FileReads } from '@sheavly/workspace/file-reads/file-reads.service';
import {
  keepFileReads,
  restoreFileReads,
} from '@sheavly/workspace/file-reads/file-reads-store.helper';
import type { WorkingRootStore } from '@sheavly/workspace/working-root/working-root.types';

/**
 * Restores what the main agent had read when this conversation was last open, and keeps it again
 * each time a prompt ends (the main session goes idle), so a reopened conversation does not read
 * the same files twice. Only the main agent's reads are kept: a sub-agent that was running comes
 * back interrupted and released. A failure to restore or keep goes to `onProblem` and the run goes
 * on, since a read only ever saves a `read_file`.
 */
export async function keepReadsWithConversation(params: {
  fileReads: FileReads;
  sessions: SessionRegistry;
  agent: string;
  store: WorkingRootStore;
  onProblem?: (caughtError: unknown) => void;
}): Promise<void> {
  const { fileReads, sessions, agent, store, onProblem = () => undefined } = params;

  try {
    await restoreFileReads({ fileReads, agent, store });
  } catch (caughtError) {
    onProblem(caughtError);
  }

  sessions.subscribe((update) => {
    if (update.type !== 'session_idle' || update.session.id !== agent) return;

    keepFileReads({ fileReads, agent, store }).catch(onProblem);
  });
}
