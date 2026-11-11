import { StoreError } from '@sheavly/core/errors/store.errors';
import type { ConversationStore, DocumentStore, EntryStore } from '@sheavly/core/store/store.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { ProfileId } from '@sheavly/protocol/profile/profile.types';
import type { ConversationId } from '@sheavly/protocol/server/server.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { StoredConversation } from '@sheavly/protocol/store/store.types';
import type { Placement } from './profiles.types.js';
import type { Profiles } from './profiles.service.js';

/** Where one conversation lives: its placement, and the store of that folder under that profile. */
type Home = { placement: Placement; store: ConversationStore };

/**
 * The backend's conversations, kept wherever each belongs: under the profile it runs on, in the
 * folder it works in. The host sees one store; this puts every conversation in its own place, so
 * several can run at once on different profiles in different folders, or in one folder.
 *
 * A new conversation is placed once, by `decide`, before anything of it is written; the placement
 * never changes, so its stream, history and index can never end up in two places. One reopened
 * after a restart was never decided in this process: the first read looks through every profile and
 * folder for it. It is not found when nothing kept it, and then there is nothing to read.
 */
export class PlacedConversationStore implements ConversationStore {
  readonly #profiles: Profiles;
  readonly #fallbackWorkspace: string;
  readonly #onProblem: Parameters<Profiles['conversationsFor']>[0]['onProblem'];
  /** Each conversation's home, as a promise so two callers asking at once share one lookup. */
  readonly #homes = new Map<ConversationId, Promise<Home | undefined>>();

  /** `fallbackWorkspace` is the folder a start that names none works in: the backend's own. */
  constructor(params: {
    profiles: Profiles;
    fallbackWorkspace: string;
    onProblem: Parameters<Profiles['conversationsFor']>[0]['onProblem'];
  }) {
    this.#profiles = params.profiles;
    this.#fallbackWorkspace = params.fallbackWorkspace;
    this.#onProblem = params.onProblem;
  }

  /**
   * Places conversation `id` and remembers it: the folder and profile it asked for, else the
   * backend's folder and the profile that folder is bound to or the default (see `Profiles.place`).
   * Rejects with what `place` rejects with. Nothing of the conversation is written before this.
   */
  async decide(params: {
    id: ConversationId;
    asked: { workspace?: string | undefined; profile?: ProfileId | undefined };
  }): Promise<Placement> {
    const { id, asked } = params;
    const placement = await this.#profiles.place({
      workspace: asked.workspace,
      profile: asked.profile,
      fallbackWorkspace: this.#fallbackWorkspace,
    });
    const store = await this.#profiles.conversationsFor({ placement, onProblem: this.#onProblem });

    this.#homes.set(id, Promise.resolve({ placement, store }));

    return placement;
  }

  entries(id: ConversationId): EntryStore {
    return {
      append: async (entry) => (await this.#placed(id)).store.entries(id).append(entry),
      read: (from) => this.#readEntries({ id, from }),
    };
  }

  shell(id: ConversationId): DocumentStore {
    return {
      load: async () => (await this.#placed(id)).store.shell(id).load(),
      update: async (change) => (await this.#placed(id)).store.shell(id).update(change),
    };
  }

  async readMessages(id: ConversationId): Promise<HistoryMessage[]> {
    const home = await this.#homeOf(id);

    return home ? home.store.readMessages(id) : [];
  }

  async writeMessages(params: {
    id: ConversationId;
    messages: readonly HistoryMessage[];
  }): Promise<void> {
    await (await this.#placed(params.id)).store.writeMessages(params);
  }

  async readAgentMessages(params: {
    id: ConversationId;
    session: SessionId;
  }): Promise<HistoryMessage[]> {
    const home = await this.#homeOf(params.id);

    return home ? home.store.readAgentMessages(params) : [];
  }

  async writeAgentMessages(params: {
    id: ConversationId;
    session: SessionId;
    messages: readonly HistoryMessage[];
  }): Promise<void> {
    await (await this.#placed(params.id)).store.writeAgentMessages(params);
  }

  /** Every kept conversation of every profile and folder, oldest first. */
  async list(): Promise<StoredConversation[]> {
    const every = await this.#profiles.everyStore({ onProblem: this.#onProblem });
    const lists = await Promise.all(every.map(({ store }) => store.list()));

    return lists.flat().sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1));
  }

  async writeIndex(conversation: StoredConversation): Promise<void> {
    await (await this.#placed(conversation.id)).store.writeIndex(conversation);
  }

  async delete(id: ConversationId): Promise<void> {
    const home = await this.#homeOf(id);

    await home?.store.delete(id);
    this.#homes.delete(id);
  }

  async *#readEntries(params: { id: ConversationId; from: number | undefined }) {
    const { id, from } = params;
    const home = await this.#homeOf(id);

    if (home) yield* home.store.entries(id).read(from);
  }

  /** The home of `id`, or a `StoreError`: a conversation nobody placed is not written anywhere. */
  async #placed(id: ConversationId): Promise<Home> {
    const home = await this.#homeOf(id);

    if (!home) {
      throw new StoreError({
        reason: 'failed',
        message: `Conversation ${id} has no place: it was never started here, and nothing kept it`,
      });
    }

    return home;
  }

  /** The home of `id`: where it was decided, else wherever it was kept; `undefined` when neither. */
  async #homeOf(id: ConversationId): Promise<Home | undefined> {
    const known = this.#homes.get(id);

    if (known) return known;

    const search = this.#find(id);

    this.#homes.set(id, search);

    try {
      const home = await search;

      // Not found now does not mean never: it may be kept before the next ask.
      if (!home) this.#homes.delete(id);

      return home;
    } catch (caughtError) {
      this.#homes.delete(id);
      throw caughtError;
    }
  }

  /** Looks through every profile and folder for a kept conversation `id`. */
  async #find(id: ConversationId): Promise<Home | undefined> {
    for (const { placement, store } of await this.#profiles.everyStore({
      onProblem: this.#onProblem,
    })) {
      if ((await store.list()).some((conversation) => conversation.id === id)) {
        return { placement, store };
      }
    }

    return undefined;
  }
}
