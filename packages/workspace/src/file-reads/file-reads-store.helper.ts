import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { WorkingRootStore } from '../working-root/working-root.types.js';
import { FILE_READS_KEY } from './file-reads.constants.js';
import type { FileReads } from './file-reads.service.js';
import { parseFileViews } from './file-reads.validator.js';

/**
 * Gives `agentId` the reads its conversation kept in `store` (the conversation's `shell.json`), so a
 * reopened conversation does not read again what it already read. Nothing stored is nothing to
 * restore. Throws a `WorkspaceError` for stored reads that are not valid: the caller reports it and
 * carries on with none, since a read is only ever a reason to skip a read, never a permission.
 */
export async function restoreFileReads(params: {
  fileReads: FileReads;
  agentId: SessionId;
  store: WorkingRootStore;
}): Promise<void> {
  const { fileReads, agentId, store } = params;
  const document = await store.load();
  const stored = isRecord(document) ? document[FILE_READS_KEY] : undefined;

  if (stored === undefined) return;
  fileReads.importAgent({ agentId, views: parseFileViews(stored) });
}

/**
 * Keeps `agentId`'s reads in `store` next to the rest of the document (its working root stays), so
 * the next reopen can restore them. `keep` is for when a prompt ends, not on every read. It writes
 * only when the reads differ from what it last wrote or restored, and writes one after another,
 * so a prompt that read nothing new rewrites nothing and two saves never overlap. `remember`
 * tells it what was restored, so the first prompt after a reopen does not write it back.
 */
export function createFileReadsKeeper(params: {
  fileReads: FileReads;
  agentId: SessionId;
  store: WorkingRootStore;
}): { keep: () => Promise<void>; remember: () => void } {
  const { fileReads, agentId, store } = params;
  let last = JSON.stringify({});
  let queue: Promise<void> = Promise.resolve();

  const write = async () => {
    const views = fileReads.exportAgent({ agentId });
    const serialized = JSON.stringify(views);

    if (serialized === last) return;

    await store.update((current) => ({
      ...(isRecord(current) ? current : {}),
      [FILE_READS_KEY]: views,
    }));
    last = serialized;
  };

  return {
    remember: () => {
      last = JSON.stringify(fileReads.exportAgent({ agentId }));
    },
    // Each save runs once the one before it has settled, whether it worked or not: a failed save
    // is its own caller's to hear of and must not stop the next one.
    keep: () => {
      queue = queue.then(write, write);

      return queue;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
