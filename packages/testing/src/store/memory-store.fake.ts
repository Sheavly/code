import { StoreError } from '@sheavly/core/errors/store.errors';
import type { OutputStore } from '@sheavly/core/output/output.types';
import type {
  ConversationStore,
  DocumentStore,
  EntryStore,
  HistoryLog,
} from '@sheavly/core/store/store.types';
import { MemoryOutputStore } from './memory-output.fake.js';
import type { ConversationId } from '@sheavly/protocol/server/server.types';
import type { HistoryMessage, HistoryRecord } from '@sheavly/protocol/history/history.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { StoredConversation } from '@sheavly/protocol/store/store.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';

/**
 * Test-only: a `ConversationStore` in memory, with the same rules as a real one (entries in
 * `seq` order with no gaps, an index per conversation, `StoreError` on failure). `failWith`
 * makes every following write reject, as a full disk does, so a test can see what the host does
 * when storage fails.
 */
export class MemoryConversationStore implements ConversationStore {
  readonly #entries = new Map<ConversationId, StreamEntry[]>();
  readonly #messages = new Map<ConversationId, HistoryMessage[]>();
  /** Sub-agents' histories: conversation, then session, so two conversations never share one. */
  readonly #agentMessages = new Map<ConversationId, Map<SessionId, HistoryMessage[]>>();
  readonly #index = new Map<ConversationId, StoredConversation>();
  readonly #shells = new Map<ConversationId, unknown>();
  readonly #outputs = new Map<ConversationId, OutputStore>();
  /** Durable history logs by `<conversation>/<session>`. */
  readonly #logs = new Map<string, HistoryRecord[]>();
  #failure: Error | undefined;

  /** Every following write rejects with a `StoreError` caused by `error`; `undefined` mends it. */
  failWith(error: Error | undefined): void {
    this.#failure = error;
  }

  entries(id: ConversationId): EntryStore {
    return {
      append: async (entry) => this.#append({ id, entry }),
      read: (from = 0) => this.#read({ id, from }),
    };
  }

  history(params: { id: ConversationId; session?: SessionId | undefined }): HistoryLog {
    const key = `${params.id}/${params.session ?? ''}`;

    return {
      append: async (records) => {
        const stored = this.#logs.get(key) ?? [];

        this.#assertWritable();

        records.forEach((record, offset) => {
          if (record.seq !== stored.length + offset) {
            throw new StoreError({
              reason: 'out_of_order',
              message: `History ${key} expected record ${String(stored.length + offset)}, got ${String(record.seq)}`,
            });
          }
        });
        this.#logs.set(key, [...stored, ...structuredClone([...records])]);
      },
      read: (from = 0) => this.#readLog({ key, from }),
    };
  }

  async *#readLog(params: { key: string; from: number }): AsyncGenerator<HistoryRecord> {
    yield* (this.#logs.get(params.key) ?? [])
      .slice(params.from)
      .map((record) => structuredClone(record));
  }

  shell(id: ConversationId): DocumentStore {
    return {
      load: async () => structuredClone(this.#shells.get(id)),
      update: async (change) => {
        this.#assertWritable();
        const next = change(structuredClone(this.#shells.get(id)));

        if (next !== undefined) this.#shells.set(id, structuredClone(next));
      },
    };
  }

  outputs(id: ConversationId): OutputStore {
    const known = this.#outputs.get(id);

    if (known) return known;

    const store = new MemoryOutputStore();

    this.#outputs.set(id, store);

    return store;
  }

  async readMessages(id: ConversationId): Promise<HistoryMessage[]> {
    return structuredClone(this.#messages.get(id) ?? []);
  }

  async writeMessages(params: {
    id: ConversationId;
    messages: readonly HistoryMessage[];
  }): Promise<void> {
    this.#assertWritable();
    this.#messages.set(params.id, structuredClone([...params.messages]));
  }

  async readAgentMessages(params: {
    id: ConversationId;
    session: SessionId;
  }): Promise<HistoryMessage[]> {
    return structuredClone(this.#agentMessages.get(params.id)?.get(params.session) ?? []);
  }

  async writeAgentMessages(params: {
    id: ConversationId;
    session: SessionId;
    messages: readonly HistoryMessage[];
  }): Promise<void> {
    const { id, session, messages } = params;
    const agents = this.#agentMessages.get(id) ?? new Map<SessionId, HistoryMessage[]>();

    this.#assertWritable();
    agents.set(session, structuredClone([...messages]));
    this.#agentMessages.set(id, agents);
  }

  async list(): Promise<StoredConversation[]> {
    return [...this.#index.values()].sort((a, b) => a.startedAt - b.startedAt);
  }

  async writeIndex(conversation: StoredConversation): Promise<void> {
    this.#assertWritable();
    this.#index.set(conversation.id, conversation);
  }

  async delete(id: ConversationId): Promise<void> {
    this.#assertWritable();
    this.#entries.delete(id);
    this.#messages.delete(id);
    this.#agentMessages.delete(id);
    this.#shells.delete(id);
    this.#outputs.delete(id);

    for (const key of [...this.#logs.keys()]) {
      if (key.startsWith(`${id}/`)) this.#logs.delete(key);
    }

    this.#index.delete(id);
  }

  async #append(params: { id: ConversationId; entry: StreamEntry }): Promise<void> {
    const { id, entry } = params;
    const stored = this.#entries.get(id) ?? [];

    this.#assertWritable();

    if (entry.seq !== stored.length) {
      throw new StoreError({
        reason: 'out_of_order',
        message: `Conversation ${id} expected entry ${String(stored.length)}, got ${String(entry.seq)}`,
      });
    }

    this.#entries.set(id, [...stored, structuredClone(entry)]);
  }

  async *#read(params: { id: ConversationId; from: number }): AsyncGenerator<StreamEntry> {
    yield* (this.#entries.get(params.id) ?? []).slice(params.from).map((e) => structuredClone(e));
  }

  #assertWritable(): void {
    if (this.#failure) {
      throw new StoreError({
        reason: 'failed',
        message: `Storage failed: ${this.#failure.message}`,
        cause: this.#failure,
      });
    }
  }
}
