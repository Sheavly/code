import path from 'node:path';
import type { ConversationStore, EntryStore } from '@sheavly/core/store/store.types';
import type { HistoryMessage } from '@sheavly/protocol/message/message.types';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import type { ConversationId } from '@sheavly/protocol/server/server.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { StoredConversation } from '@sheavly/protocol/store/store.types';
import { storedConversationSchema } from '@sheavly/protocol/store/store.validator';
import { StorageFileError } from '../errors/storage.errors.js';
import { readJsonFile, writeJsonFile } from '../json-file/json-file.helper.js';
import { listFolderNames } from '../listing/listing.helper.js';
import type { FileProblem, ListedFile } from '../listing/listing.types.js';
import { splitListed } from '../listing/listing.utils.js';
import { assertSafeRoot, removeFolder } from '../safe-path/safe-path.helper.js';
import { CONVERSATIONS_FOLDER, HISTORY_FILE, INDEX_FILE } from './conversation-store.constants.js';
import { agentHistoryFile, asStoreError, conversationFolder } from './conversation-store.utils.js';
import { historySchema } from './conversation-store.validator.js';
import { EntryFile } from './entry-file.service.js';

/**
 * A workspace's conversations on disk: `<workspace folder>/conversations/<conversation-id>/`, one
 * folder each, holding `index.json`, `stream.jsonl`, `history.json` and `agents/<session-id>.history.json`.
 * Everything is named by an id, so no title or path from a person reaches a file name, and
 * deleting a conversation deletes its folder and nothing else.
 *
 * It rejects with a `StoreError`, as the `ConversationStore` contract says, and its messages name
 * the file and never what it holds: a conversation is private. One process owns a workspace's
 * conversations at a time; the stream's order rests on that (see `EntryFile`).
 */
export class FileConversationStore implements ConversationStore {
  readonly #folder: string;
  readonly #onProblem: (problem: FileProblem) => void;
  readonly #streams = new Map<ConversationId, EntryFile>();

  /**
   * `folder` is the workspace's folder (`<profile folder>/workspaces/<workspace-key>`), which an
   * app passes in. `onProblem` is told about each conversation `list` could not use, since the
   * list itself has no place for it: a typo in one index must not hide the others, nor vanish.
   */
  constructor(params: { folder: string; onProblem: (problem: FileProblem) => void }) {
    this.#folder = path.join(assertSafeRoot(params.folder), CONVERSATIONS_FOLDER);
    this.#onProblem = params.onProblem;
  }

  entries(id: ConversationId): EntryStore {
    const folder = this.#folderOf(id);
    const existing = this.#streams.get(id);

    if (existing) return existing;

    const stream = new EntryFile({ folder, conversationId: id });

    this.#streams.set(id, stream);

    return stream;
  }

  async readMessages(id: ConversationId): Promise<HistoryMessage[]> {
    return this.#readHistory(path.join(this.#folderOf(id), HISTORY_FILE));
  }

  async writeMessages(params: {
    id: ConversationId;
    messages: readonly HistoryMessage[];
  }): Promise<void> {
    await this.#writeHistory({
      file: path.join(this.#folderOf(params.id), HISTORY_FILE),
      messages: params.messages,
    });
  }

  async readAgentMessages(params: {
    id: ConversationId;
    session: SessionId;
  }): Promise<HistoryMessage[]> {
    const folder = this.#folderOf(params.id);

    return this.#readHistory(agentHistoryFile({ folder, session: params.session }));
  }

  async writeAgentMessages(params: {
    id: ConversationId;
    session: SessionId;
    messages: readonly HistoryMessage[];
  }): Promise<void> {
    const { id, session, messages } = params;

    await this.#writeHistory({
      file: agentHistoryFile({ folder: this.#folderOf(id), session }),
      messages,
    });
  }

  /**
   * The conversations that have an index, oldest first (then by id, so the order is the same on
   * every system). A folder without an `index.json` is a conversation whose stream has started and
   * whose index is not written yet, and is not listed. Each folder that is not a usable
   * conversation goes to `onProblem` and the rest are listed.
   */
  async list(): Promise<StoredConversation[]> {
    try {
      const names = await this.#conversationNames();
      const { items, problems } = splitListed(
        await Promise.all(names.map((name) => this.#readListed(name))),
      );

      for (const problem of problems) this.#onProblem(problem);

      return items.sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1));
    } catch (caughtError) {
      throw asStoreError(caughtError);
    }
  }

  async writeIndex(conversation: StoredConversation): Promise<void> {
    const file = path.join(this.#folderOf(conversation.id), INDEX_FILE);

    try {
      await writeJsonFile({ file, value: conversation });
    } catch (caughtError) {
      throw asStoreError(caughtError);
    }
  }

  async delete(id: ConversationId): Promise<void> {
    const folder = this.#folderOf(id);

    try {
      await this.#streams.get(id)?.forget();
      await removeFolder({ root: this.#folder, folder });
      this.#streams.delete(id);
    } catch (caughtError) {
      throw asStoreError(caughtError);
    }
  }

  #folderOf(id: ConversationId): string {
    return conversationFolder({ conversations: this.#folder, id });
  }

  async #readHistory(file: string): Promise<HistoryMessage[]> {
    try {
      // A conversation is private text, so a file that is not JSON is reported without quoting it.
      return (await readJsonFile({ file, schema: historySchema, holdsSecrets: true })) ?? [];
    } catch (caughtError) {
      throw asStoreError(caughtError);
    }
  }

  async #writeHistory(params: {
    file: string;
    messages: readonly HistoryMessage[];
  }): Promise<void> {
    try {
      await writeJsonFile({ file: params.file, value: params.messages });
    } catch (caughtError) {
      throw asStoreError(caughtError);
    }
  }

  /** The folders that could be conversations: folders only, not hidden, in a fixed order. */
  async #conversationNames(): Promise<string[]> {
    return listFolderNames({ folder: this.#folder });
  }

  /** One folder of the listing: its index, nothing when it has none yet, or what is wrong with it. */
  async #readListed(name: string): Promise<ListedFile<StoredConversation>> {
    const folder = path.join(this.#folder, name);
    const id = conversationIdSchema.safeParse(name);

    if (!id.success) {
      return {
        problem: {
          file: folder,
          message:
            'its name is not a conversation id, a lowercase UUID. Nothing here is named by hand',
        },
      };
    }

    try {
      const stored = await readJsonFile({
        file: path.join(folder, INDEX_FILE),
        schema: storedConversationSchema,
        holdsSecrets: true,
      });

      if (!stored) return undefined;

      return stored.id === id.data
        ? { item: stored }
        : {
            problem: {
              file: path.join(folder, INDEX_FILE),
              message: `it holds the conversation ${stored.id}, but its folder is named for ${id.data}: a copy or a rename by hand`,
            },
          };
    } catch (caughtError) {
      // Only an index that cannot be used is a problem to list; any other failure is not ours to hide.
      if (caughtError instanceof StorageFileError) {
        return { problem: { file: caughtError.file, message: caughtError.message } };
      }

      throw caughtError;
    }
  }
}
