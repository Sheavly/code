import type { SessionId, SessionInfo } from '@sheavly/protocol/session/session.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type { EntryFilter } from './sessions.types.js';
import { deepFreeze, notifyAll } from './listeners.helper.js';

type EntryListener = (entry: StreamEntry) => void;

/**
 * A session tree's combined stream: every entry numbered 0, 1, 2, ... across all sessions, in the
 * order it was added, and kept for the life of the run so a listener that joins late can catch up.
 * Each entry is a frozen copy, so no listener can change what the run itself holds, and a listener
 * that throws never reaches the run or the listeners after it.
 */
export class EntryLog {
  #entries: StreamEntry[] = [];
  #listeners = new Map<EntryListener, (entry: StreamEntry) => boolean>();
  readonly #lineage: (id: SessionId) => SessionInfo[];

  /** `lineage` walks a session up to the main session, for a filter on a whole subtree. */
  constructor(params: { lineage: (id: SessionId) => SessionInfo[] }) {
    this.#lineage = params.lineage;
  }

  /** Numbers the next entry, keeps a frozen copy of it, and tells every listener it matches. */
  add(build: (seq: number) => StreamEntry): void {
    const entry = deepFreeze(structuredClone(build(this.#entries.length)));

    this.#entries.push(entry);
    notifyAll({
      listeners: [...this.#listeners].filter(([, matches]) => matches(entry)).map(([l]) => l),
      value: entry,
    });
  }

  /**
   * Calls `listener` for each entry `filter` matches: with `replay`, first every one so far, then
   * live. Returns a function that stops it.
   */
  subscribe(params: { listener: EntryListener; filter?: EntryFilter }): () => void {
    const { listener, filter = {} } = params;
    const matches = this.#matcher(filter);

    if (filter.replay) {
      for (const entry of this.#entries.filter(matches)) {
        notifyAll({ listeners: [listener], value: entry });
      }
    }

    this.#listeners.set(listener, matches);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  #matcher(filter: EntryFilter): (entry: StreamEntry) => boolean {
    const { sessionId, subtree = false } = filter;

    if (sessionId === undefined) return () => true;
    if (!subtree) return (entry) => entry.sessionId === sessionId;

    return (entry) => this.#lineage(entry.sessionId).some((session) => session.id === sessionId);
  }
}
