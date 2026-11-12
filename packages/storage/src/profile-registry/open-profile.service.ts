import path from 'node:path';
import type { Model, ModelId } from '@sheavly/protocol/model/model.types';
import type { ProfileId } from '@sheavly/protocol/profile/profile.types';
import { workspaceKey } from '../config-store/config-store.utils.js';
import { workspaceKeySchema } from '../config-store/config-store.validator.js';
import { FileConversationStore } from '../conversation-store/conversation-store.service.js';
import { CredentialStore } from '../credential-store/credential-store.service.js';
import type { Secrets } from '../credential-store/credential-store.types.js';
import { RegistryError } from '../errors/registry.errors.js';
import { StorageFileError } from '../errors/storage.errors.js';
import { readJsonFile, writeJsonFile } from '../json-file/json-file.helper.js';
import { listFolderNames } from '../listing/listing.helper.js';
import type { FileProblem } from '../listing/listing.types.js';
import { ModelStore } from '../model-store/model-store.service.js';
import type { ModelListing } from '../model-store/model-store.types.js';
import { WORKSPACE_FILE, WORKSPACES_FOLDER } from '../profile-store/profile-store.constants.js';
import type { ProfileStore } from '../profile-store/profile-store.service.js';
import { namedPath } from '../safe-path/safe-path.helper.js';
import { requireProfile } from './profile-registry.helper.js';
import { workspaceFileSchema } from './workspace-file.validator.js';
import { workspaceFileProblem } from './workspace-file.utils.js';

/**
 * One profile opened for use: its models and its keys, held together so they can't drift apart.
 * Get it from `ProfileRegistry.open`, which hands out one per profile (the credential store queues
 * its writes in memory, so a second one on the same file would not know of the first's).
 *
 * - A model is removed with its key: the key goes first, so a failure leaves a model without a key
 *   (set it again) and never a key for a model that no longer exists.
 * - A key can only be set for a model that exists.
 * - Every write first checks the profile still exists, so a profile deleted in the meantime is not
 *   quietly recreated as a folder holding one key. A delete that lands between that check and the
 *   write can still leave such a folder; the listing reports it, and deleting the profile clears it.
 */
export class OpenProfile {
  readonly id: ProfileId;
  readonly #profiles: ProfileStore;
  readonly #folder: string;
  readonly #models: ModelStore;
  readonly #credentials: CredentialStore;
  /** One store per workspace, so every conversation in it shares its streams' write queues. */
  readonly #conversations = new Map<string, FileConversationStore>();
  /** Stores being created, so concurrent callers for one workspace share the one creation. */
  readonly #opening = new Map<string, Promise<FileConversationStore>>();

  constructor(params: { id: ProfileId; profiles: ProfileStore }) {
    const { id, profiles } = params;
    const folder = profiles.folderOf(id);

    this.id = id;
    this.#profiles = profiles;
    this.#folder = folder;
    this.#models = new ModelStore({ folder });
    this.#credentials = new CredentialStore({ folder });
  }

  /**
   * The conversations of the workspace at `realPath` (its real path, symlinks followed) under this
   * profile: `workspaces/<workspace-key>/conversations/`. The same store every time for one
   * workspace. The folder is named by a hash of the path, so `workspace.json` beside it says which
   * path it is, for a person who looks. `onProblem` is told about each conversation the listing
   * cannot use (see `FileConversationStore`).
   */
  async conversations(params: {
    realPath: string;
    onProblem: (problem: FileProblem) => void;
  }): Promise<FileConversationStore> {
    const { realPath, onProblem } = params;
    const key = workspaceKey({ realPath });
    const known = this.#conversations.get(key);

    if (known) return known;

    // One creation per workspace at a time: two callers must never build two stores over one
    // folder, since each would count its own quota and live captures.
    const opening =
      this.#opening.get(key) ?? this.#createConversations({ key, realPath, onProblem });

    this.#opening.set(key, opening);

    try {
      return await opening;
    } finally {
      this.#opening.delete(key);
    }
  }

  async #createConversations(params: {
    key: ReturnType<typeof workspaceKey>;
    realPath: string;
    onProblem: (problem: FileProblem) => void;
  }): Promise<FileConversationStore> {
    const { key, realPath, onProblem } = params;

    await this.#assertProfile();

    const folder = namedPath({
      folder: path.join(this.#folder, WORKSPACES_FOLDER),
      id: key,
      shape: workspaceKeySchema,
    });
    const store = this.#conversations.get(key) ?? new FileConversationStore({ folder, onProblem });

    await writeJsonFile({ file: path.join(folder, WORKSPACE_FILE), value: { root: realPath } });
    this.#conversations.set(key, store);

    return store;
  }

  /**
   * Every workspace this profile keeps conversations for, each with its store: the same store
   * `conversations` hands out for that path, so listing and writing share their queues. A workspace
   * folder that is not one (not named by a key, no readable `workspace.json`, or one that names a
   * path of another key) is told to `onProblem` and left out, never taken for empty or hidden.
   */
  async workspaces(params: {
    onProblem: (problem: FileProblem) => void;
  }): Promise<{ root: string; store: FileConversationStore }[]> {
    const { onProblem } = params;
    const parent = path.join(this.#folder, WORKSPACES_FOLDER);
    const found: { root: string; store: FileConversationStore }[] = [];

    for (const key of await listFolderNames({ folder: parent })) {
      const folder = path.join(parent, key);
      const root = await this.#workspaceRoot({ key, folder, onProblem });

      if (root === undefined) continue;

      const store =
        this.#conversations.get(key) ?? new FileConversationStore({ folder, onProblem });

      this.#conversations.set(key, store);
      found.push({ root, store });
    }

    return found;
  }

  /** The path a workspace folder is for, or `undefined` (told to `onProblem`) when it isn't one. */
  async #workspaceRoot(params: {
    key: string;
    folder: string;
    onProblem: (problem: FileProblem) => void;
  }): Promise<string | undefined> {
    const { key, folder, onProblem } = params;
    const problem = (message: string) => onProblem({ file: folder, message });

    if (!workspaceKeySchema.safeParse(key).success) {
      problem('its name is not a workspace key');

      return undefined;
    }

    try {
      const file = await readJsonFile({
        file: path.join(folder, WORKSPACE_FILE),
        schema: workspaceFileSchema,
        holdsSecrets: false,
      });
      const reason = workspaceFileProblem({ file, key });

      if (reason) {
        problem(reason);

        return undefined;
      }

      return file?.root;
    } catch (caughtError) {
      // Only an unreadable or invalid file is told as a problem; anything else is not ours to hide.
      if (!(caughtError instanceof StorageFileError)) throw caughtError;
      problem(caughtError.message);

      return undefined;
    }
  }

  /** The profile's models, and a problem for each file that isn't one (see `ModelStore.list`). */
  async listModels(): Promise<ModelListing> {
    return this.#models.list();
  }

  /** The model with this id, or `undefined`. */
  async getModel(id: ModelId): Promise<Model | undefined> {
    return this.#models.get(id);
  }

  /**
   * Stores `model`, replacing the one with its id. Its definition must already be checked and hold
   * no secret (`AdapterRegistry.validateDefinition`); the model's key is set apart, by `putSecrets`.
   */
  async putModel(model: Model): Promise<void> {
    await this.#assertProfile();
    await this.#models.put(model);
  }

  /**
   * Removes a model and its key, the key first. A key left from a model whose file is already gone
   * is removed too. None of either is fine.
   */
  async removeModel(id: ModelId): Promise<void> {
    await this.#credentials.remove(id);
    await this.#models.remove(id);
  }

  /**
   * Which models have keys, and the names of the fields set, never their values: what a UI shows
   * to say "a key is set" with no way to read it back.
   */
  async secretFields(): Promise<Record<string, string[]>> {
    return this.#credentials.fieldsSet();
  }

  /** The secrets of model `id`, to hand to its provider, or `undefined` when it has none. */
  async getSecrets(id: ModelId): Promise<Secrets | undefined> {
    return this.#credentials.get(id);
  }

  /**
   * Sets model `id`'s secrets, replacing the ones it had. Throws a `RegistryError` (`unknown_model`)
   * when the profile has no such model: a key for nothing is a typo, not a setting.
   */
  async putSecrets(params: { id: ModelId; secrets: Secrets }): Promise<void> {
    const { id, secrets } = params;

    await this.#assertProfile();

    if (!(await this.#models.get(id))) {
      throw new RegistryError({
        reason: 'unknown_model',
        message: `Profile ${this.id} has no model ${id}: add the model before its key`,
      });
    }

    await this.#credentials.put({ id, secrets });
  }

  /**
   * Forgets model `id`'s secrets and keeps the model. None set is fine, as is a model that is
   * gone: a key left behind by one is removed all the same.
   */
  async removeSecrets(id: ModelId): Promise<void> {
    await this.#assertProfile();
    await this.#credentials.remove(id);
  }

  async #assertProfile(): Promise<void> {
    await requireProfile({ profiles: this.#profiles, id: this.id });
  }
}
