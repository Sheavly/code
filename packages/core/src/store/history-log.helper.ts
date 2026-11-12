import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { HistoryLog } from './store.types.js';

/** Every entry of `log`, in order: what a session continues from. Rejects with a `StoreError`. */
export async function readHistoryEntries(log: HistoryLog): Promise<HistoryMessage[]> {
  const entries: HistoryMessage[] = [];

  for await (const record of log.read()) entries.push(record.entry);

  return entries;
}
