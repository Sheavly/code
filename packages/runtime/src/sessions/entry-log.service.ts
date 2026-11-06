import type { StoreError } from '@sheavly/core/errors/store.errors';
import { now } from '@sheavly/core/clock/clock.helper';
import type { EntryStore } from '@sheavly/core/store/store.types';
import type { SessionId, SessionInfo } from '@sheavly/protocol/session/session.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { toStoreError } from '@sheavly/core/store/store.utils';
import { replayStored } from './entry-replay.helper.js';
import type { EntryFilter, StoredLog } from './sessions.types.js';
import { ENTRY_TAIL_SIZE } from './sessions.constants.js';
import { deepFreeze, notifyAll } from './listeners.helper.js';

type EntryListener = (entry: StreamEntry) => void;
type Matcher = (entry: StreamEntry) => boolean;

/**
 * A session tree's combined stream: every entry numbered 0, 1, 2, ... across all sessions, in the
 * order it was added, kept so a listener that joins late can catch up. Each entry is a frozen
 * copy, so no listener can change what the run itself holds, and a listener that throws never
 * reaches the run or the listeners after it.
 *
 * Without a store, every entry stays in memory for the life of the run. With one, each entry is
 * also written to it, in order, and only the newest `ENTRY_TAIL_SIZE` stay in memory: a replay
 * that reaches further back reads the rest from the store, so a long conversation's memory is
 * bounded. If a write fails, nothing more is written and `failure` says why: the log goes on in
 * memory, and whoever owns the conversation decides to stop it.
 */
export class EntryLog {
  #tail: StreamEntry[] = [];
  /** The `seq` of the first entry in `#tail`; the ones before it are only in the store. */
  #tailStart = 0;
  #listeners = new Map<EntryListener, Matcher>();
  readonly #lineage: (id: SessionId) => SessionInfo[];
  readonly #store: EntryStore | undefined;
  /** The writes queued so far, one after another. Never rejects: a failure goes to `#failure`. */
  #written: Promise<void> = Promise.resolve();
  #failure: StoreError | undefined;

  /**
   * `lineage` walks a session up to the main session, for a filter on a whole subtree. `resume`
   * carries on a stored conversation: numbering continues from it and its newest entries are the
   * ones in memory, the rest being in the store (so `resume` needs the store it was read from).
   */
  constructor(params: {
    lineage: (id: SessionId) => SessionInfo[];
    store?: EntryStore;
    resume?: Pick<StoredLog, 'next' | 'tail'>;
  }) {
    this.#lineage = params.lineage;
    this.#store = params.store;

    const { resume } = params;

    if (!resume) return;

    this.#tail = resume.tail.map((entry) => deepFreeze(entry));
    this.#tailStart = resume.next - this.#tail.length;
  }

  /** The first failed write, if any. The entries since it are in memory only. */
  get failure(): StoreError | undefined {
    return this.#failure;
  }

  /** How many entries are in memory: all of them without a store, the newest few with one. */
  get retained(): number {
    return this.#tail.length;
  }

  /** Resolves once every entry added so far has been written (or a write has failed). */
  flush(): Promise<void> {
    return this.#written;
  }

  /**
   * Numbers the next entry, stamps it with the time, keeps a frozen copy of it, and tells every
   * listener it matches. The builder gives the entry's content; `seq` and `at` are the log's.
   */
  add(build: (seq: number) => Omit<StreamEntry, 'at'>): void {
    const entry = deepFreeze(
      structuredClone({ ...build(this.#tailStart + this.#tail.length), at: now() }),
    ) as StreamEntry;

    this.#tail.push(entry);
    this.#queueWrite(entry);
    this.#dropOldFromMemory();
    notifyAll({
      listeners: [...this.#listeners].filter(([, matches]) => matches(entry)).map(([l]) => l),
      value: entry,
    });
  }

  /**
   * Calls `listener` for each entry `filter` matches: with `replay`, first every one so far, then
   * live. Returns a function that stops it. A replay reaching entries only the store holds is
   * delivered later, in order and before any live entry; if the store can't give them all, it
   * calls `onError` (or, with none, fails as an uncaught error) and delivers no more.
   */
  subscribe(params: {
    listener: EntryListener;
    filter?: EntryFilter;
    onError?: (error: StoreError) => void;
  }): () => void {
    const { listener, filter = {}, onError } = params;
    const matches = this.#matcher(filter);

    if (!filter.replay) return this.#listen({ listener, matches });

    if (this.#tailStart === 0 || !this.#store) {
      for (const entry of this.#tail.filter(matches)) {
        notifyAll({ listeners: [listener], value: entry });
      }

      return this.#listen({ listener, matches });
    }

    return this.#replayFromStore({ store: this.#store, listener, matches, onError });
  }

  #listen(params: { listener: EntryListener; matches: Matcher }): () => void {
    const { listener, matches } = params;

    this.#listeners.set(listener, matches);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Replays what only the store holds, then what is in memory, then live. Entries that arrive
   * while the store is read wait in `pending`, so the listener sees one unbroken order.
   */
  #replayFromStore(params: {
    store: EntryStore;
    listener: EntryListener;
    matches: Matcher;
    onError: ((error: StoreError) => void) | undefined;
  }): () => void {
    const { store, listener, matches, onError } = params;
    const pending = this.#tail.filter(matches);
    let caughtUp = false;
    let stopped = false;
    const arrive: EntryListener = (entry) => {
      if (caughtUp) notifyAll({ listeners: [listener], value: entry });
      else pending.push(entry);
    };
    const stop = this.#listen({ listener: arrive, matches });

    replayStored({
      store,
      written: this.#written,
      upTo: this.#tailStart,
      matches,
      deliver: (entry) => notifyAll({ listeners: [listener], value: entry }),
      stopped: () => stopped,
    }).then(
      () => {
        if (stopped) return;

        // The listener may add entries as it is handed these, and they join `pending` too.
        for (const entry of pending) notifyAll({ listeners: [listener], value: entry });
        caughtUp = true;
      },
      (caughtError: unknown) => {
        stop();
        reportReplayFailure({ error: caughtError, onError });
      },
    );

    return () => {
      stopped = true;
      stop();
    };
  }

  /** Queues the write after the ones before it. Once one fails, no later one is attempted. */
  #queueWrite(entry: StreamEntry): void {
    const store = this.#store;

    if (!store) return;

    this.#written = this.#written.then(async () => {
      if (this.#failure) return;

      try {
        await store.append(entry);
      } catch (caughtError) {
        this.#failure = toStoreError({
          error: caughtError,
          message: `Could not store entry ${String(entry.seq)}`,
        });
      }
    });
  }

  /**
   * With a store, the oldest entries leave memory as new ones arrive; the store has them. Not
   * once a write has failed: those entries exist nowhere else.
   */
  #dropOldFromMemory(): void {
    if (!this.#store) return;

    while (!this.#failure && this.#tail.length > ENTRY_TAIL_SIZE) {
      this.#tail.shift();
      this.#tailStart++;
    }
  }

  #matcher(filter: EntryFilter): Matcher {
    const { sessionId, subtree = false } = filter;

    if (sessionId === undefined) return () => true;
    if (!subtree) return (entry) => entry.sessionId === sessionId;

    return (entry) => this.#lineage(entry.sessionId).some((session) => session.id === sessionId);
  }
}

/** Tells `onError` that a replay failed; with none, fails loudly like a throwing listener. */
function reportReplayFailure(params: {
  error: unknown;
  onError: ((error: StoreError) => void) | undefined;
}): void {
  const error = toStoreError({ error: params.error, message: 'Could not replay stored entries' });

  if (params.onError) {
    params.onError(error);

    return;
  }

  queueMicrotask(() => {
    throw error;
  });
}
