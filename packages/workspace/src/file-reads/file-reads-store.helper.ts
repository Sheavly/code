import type { WorkingRootStore } from '../working-root/working-root.types.js';
import { FILE_READS_KEY } from './file-reads.constants.js';
import type { FileReads } from './file-reads.service.js';
import { parseFileViews } from './file-reads.validator.js';

/**
 * Gives `agent` the reads its conversation kept in `store` (the conversation's `shell.json`), so a
 * reopened conversation does not read again what it already read. Nothing stored is nothing to
 * restore. Throws a `WorkspaceError` for stored reads that are not valid: the caller reports it and
 * carries on with none, since a read is only ever a reason to skip a read, never a permission.
 */
export async function restoreFileReads(params: {
  fileReads: FileReads;
  agent: string;
  store: WorkingRootStore;
}): Promise<void> {
  const { fileReads, agent, store } = params;
  const document = await store.load();
  const stored = isRecord(document) ? document[FILE_READS_KEY] : undefined;

  if (stored === undefined) return;
  fileReads.importAgent({ agent, views: parseFileViews(stored) });
}

/**
 * Keeps `agent`'s reads in `store` next to the rest of the document (its working root stays), so
 * the next reopen can restore them. Call it when a prompt ends, not on every read.
 */
export async function keepFileReads(params: {
  fileReads: FileReads;
  agent: string;
  store: WorkingRootStore;
}): Promise<void> {
  const { fileReads, agent, store } = params;
  const views = fileReads.exportAgent({ agent });

  await store.update((current) => ({
    ...(isRecord(current) ? current : {}),
    [FILE_READS_KEY]: views,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
